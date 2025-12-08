const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- ОЙЫН ЛОГИКАСЫ ---

const SUITS = ['♥', '♦', '♣', '♠'];
const VALUES = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POWER = {'6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14};

let gameState = {
    deck: [],
    trumpCard: null,
    playerHand: [],
    botHand: [],
    table: [], // { card: obj, defendedBy: obj/null }
    attacker: 'player', // 'player' немесе 'bot'
    winner: null
};

// 1. Колода жасау және араластыру
function createDeck() {
    let deck = [];
    for (let s of SUITS) {
        for (let v of VALUES) {
            deck.push({ suit: s, value: v });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

// 2. Ойынды бастау (Reset)
function startNewGame() {
    gameState.deck = createDeck();
    gameState.playerHand = [];
    gameState.botHand = [];
    gameState.table = [];
    gameState.winner = null;

    // 6 картадан тарату
    for(let i=0; i<6; i++) {
        gameState.playerHand.push(gameState.deck.pop());
        gameState.botHand.push(gameState.deck.pop());
    }

    // Козырь таңдау
    gameState.trumpCard = gameState.deck[0]; // Колоданың түбіндегі карта
    
    // Ең кіші козырь кімде? (Бастаушыны анықтау логикасы - әзірге Player бастайды деп қояйық)
    gameState.attacker = 'player';
}

// 3. Қолға карта толтыру (6-ға дейін)
function drawCards() {
    while (gameState.playerHand.length < 6 && gameState.deck.length > 0) {
        gameState.playerHand.push(gameState.deck.pop());
    }
    while (gameState.botHand.length < 6 && gameState.deck.length > 0) {
        gameState.botHand.push(gameState.deck.pop());
    }
}

// 4. Карта күшін салыстыру (Beat logic)
function canBeat(attackCard, defendCard) {
    const trump = gameState.trumpCard.suit;
    
    // Егер қорғанушы козырь болса
    if (defendCard.suit === trump) {
        if (attackCard.suit !== trump) return true; // Жай картаны козырь ұрады
        return POWER[defendCard.value] > POWER[attackCard.value]; // Козырьді үлкен козырь ұрады
    }
    
    // Егер масть сәйкес келсе
    if (attackCard.suit === defendCard.suit) {
        return POWER[defendCard.value] > POWER[attackCard.value];
    }

    return false;
}

// 5. Боттың жүрісі (AI)
function botAction() {
    if (gameState.winner) return;

    // A. Егер БОТ шабуылдаушы болса
    if (gameState.attacker === 'bot') {
        // 1. Егер үстел бос болса -> Ең кіші картамен жүреді
        if (gameState.table.length === 0) {
            // Козырь емес ең кіші картаны іздейміз
            gameState.botHand.sort((a,b) => POWER[a.value] - POWER[b.value]);
            let cardToPlay = gameState.botHand.find(c => c.suit !== gameState.trumpCard.suit) || gameState.botHand[0];
            
            removeCard(gameState.botHand, cardToPlay);
            gameState.table.push({ card: cardToPlay, defendedBy: null });
        } 
        // 2. Үстелде карта бар -> Подкидной (Тастау)
        else {
            let possibleCards = getPossibleThrowCards(gameState.botHand);
            if (possibleCards.length > 0) {
                // Ең кішісін тастайды
                possibleCards.sort((a,b) => POWER[a.value] - POWER[b.value]);
                let card = possibleCards[0];
                removeCard(gameState.botHand, card);
                // Жабылмаған (соңғы) жұпқа емес, жаңа жұп ашамыз
                // Бірақ Дурак ережесінде қорғанушы жауып болған соң ғана тастау керек немесе бірден тастауға болады.
                // Оңай болу үшін: Егер бәрі жабық болса ғана тастайды деп есептейік
                gameState.table.push({ card: card, defendedBy: null });
            } else {
                // Тастайтын карта жоқ -> Бита
                io.emit('updateState', getPublicState()); // Алдымен көрсету
                handleBita();
                return; 
            }
        }
    } 
    // B. Егер БОТ қорғанушы болса
    else {
        // Жабылмаған карталарды іздейміз
        let undefended = gameState.table.find(pair => !pair.defendedBy);
        if (undefended) {
            let attackCard = undefended.card;
            // Ұра алатын барлық карталарды табамыз
            let candidates = gameState.botHand.filter(c => canBeat(attackCard, c));
            
            if (candidates.length > 0) {
                // Ең кішісімен ұрамыз (үнемдеу үшін)
                candidates.sort((a,b) => POWER[a.value] - POWER[b.value]);
                let bestCard = candidates[0];
                
                removeCard(gameState.botHand, bestCard);
                undefended.defendedBy = bestCard;
            } else {
                // Ұра алмайды -> Алады
                handleTake('bot');
                return;
            }
        }
    }

    checkWin();
    io.emit('updateState', getPublicState());
}

function getPossibleThrowCards(hand) {
    // Үстелдегі барлық мәндерді (value) жинаймыз
    let tableValues = new Set();
    gameState.table.forEach(pair => {
        tableValues.add(pair.card.value);
        if (pair.defendedBy) tableValues.add(pair.defendedBy.value);
    });
    
    return hand.filter(c => tableValues.has(c.value));
}

function removeCard(hand, card) {
    const idx = hand.indexOf(card);
    if (idx > -1) hand.splice(idx, 1);
}

function handleBita() {
    gameState.table = []; // Үстелді тазалау
    drawCards(); // Карта тарату
    
    // Бита болса, шабуылдаушы кезегі ауысады
    gameState.attacker = (gameState.attacker === 'player') ? 'bot' : 'player';
    
    io.emit('updateState', getPublicState());
    
    // Егер кезек ботқа келсе, ол жүреді
    if (gameState.attacker === 'bot') {
        setTimeout(botAction, 1000);
    }
}

function handleTake(who) {
    // Үстелдегі барлық картаны жинап алу
    let allCards = [];
    gameState.table.forEach(pair => {
        allCards.push(pair.card);
        if (pair.defendedBy) allCards.push(pair.defendedBy);
    });
    gameState.table = [];

    if (who === 'player') {
        gameState.playerHand.push(...allCards);
        gameState.attacker = 'bot'; // Кезек ботқа өтеді (шабуылдайды)
    } else {
        gameState.botHand.push(...allCards);
        gameState.attacker = 'player'; // Кезек адамға өтеді
    }

    drawCards(); // Карта жетпей қалса тарату
    io.emit('updateState', getPublicState());

    if (gameState.attacker === 'bot') {
        setTimeout(botAction, 1000);
    }
}

function checkWin() {
    if (gameState.deck.length === 0) {
        if (gameState.playerHand.length === 0) gameState.winner = 'player';
        else if (gameState.botHand.length === 0) gameState.winner = 'bot';
    }
}

// Клиентке жіберетін деректер
function getPublicState() {
    return {
        playerHand: gameState.playerHand,
        botCardCount: gameState.botHand.length, // Боттың картасын көрсетпейміз, тек санын
        table: gameState.table,
        trumpCard: gameState.trumpCard,
        deckCount: gameState.deck.length,
        attacker: gameState.attacker,
        winner: gameState.winner
    };
}

// --- SOCKET EVENTS ---

io.on('connection', (socket) => {
    console.log('User connected');
    if (gameState.deck.length === 0) startNewGame();
    
    socket.emit('updateState', getPublicState());

    // 1. Ойыншы карта тастады
    socket.on('playCard', (index) => {
        if (gameState.winner) return;
        
        // Индекстің дұрыстығын тексеру
        if (index < 0 || index >= gameState.playerHand.length) return;
        
        const card = gameState.playerHand[index];
        let moveValid = false;

        // A. Ойыншы ШАБУЫЛДАП жатыр
        if (gameState.attacker === 'player') {
            // Егер үстел бос болса - кез келген карта
            if (gameState.table.length === 0) {
                moveValid = true;
                gameState.table.push({ card: card, defendedBy: null });
            } 
            // Подкидной (үстелде бар мән)
            else {
                let tableValues = new Set();
                gameState.table.forEach(p => {
                    tableValues.add(p.card.value);
                    if(p.defendedBy) tableValues.add(p.defendedBy.value);
                });
                
                if (tableValues.has(card.value)) {
                    // Жаңа слот ашамыз
                     // Дуракта егер алдыңғы карта жабылмаса, тастауға болмайды деген ереже бар,
                     // бірақ "простой дуракта" кейде болады. Біз қатаң ереже жасайық:
                     // Тек барлық карта жабылғанда ғана үстемелей алады
                     const allCovered = gameState.table.every(t => t.defendedBy !== null);
                     if (allCovered && gameState.table.length < 6) {
                         moveValid = true;
                         gameState.table.push({ card: card, defendedBy: null });
                     }
                }
            }
        } 
        // B. Ойыншы ҚОРҒАНЫП жатыр
        else {
            // Жабылмаған картаны іздейміз
            let undefendedPair = gameState.table.find(p => !p.defendedBy);
            if (undefendedPair) {
                if (canBeat(undefendedPair.card, card)) {
                    moveValid = true;
                    undefendedPair.defendedBy = card;
                }
            }
        }

        if (moveValid) {
            gameState.playerHand.splice(index, 1); // Қолдан өшіру
            checkWin();
            io.emit('updateState', getPublicState());
            
            // Енді бот ойлану керек
            setTimeout(botAction, 1000); 
        } else {
            // Қате жүріс - клиентке хабарлауға болады немесе жай ғана елемеу
            // (Клиенттегі анимация "reset" жасайды)
        }
    });

    // 2. Ойыншы "АЛУ" батырмасын басты
    socket.on('actionTake', () => {
        if (gameState.attacker === 'bot') { // Тек қорғанып жатқанда ала алады
            handleTake('player');
        }
    });

    // 3. Ойыншы "БИТА" батырмасын басты
    socket.on('actionBita', () => {
        if (gameState.attacker === 'player') { // Тек шабуылдап жатқанда бита дей алады
            // Барлығы жабылған болуы керек
            const allCovered = gameState.table.every(t => t.defendedBy !== null);
            if (allCovered && gameState.table.length > 0) {
                handleBita();
            }
        }
    });

    // 4. Restart
    socket.on('restart', () => {
        startNewGame();
        io.emit('updateState', getPublicState());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startNewGame();
});
