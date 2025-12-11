const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// СУРЕТТЕР МЕН СТИЛЬДЕРДІ АШУ (ӨЗГЕРІССІЗ)
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// Ойын файлын ашу үшін жол ашамыз
app.get('/game.html', (req, res) => {
  res.sendFile(__dirname + '/game.html');
});


const io = new Server(server, { cors: { origin: "*" } });

// --- ОЙЫН ДЕРЕКТЕРІ ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
// Картаның күші (Логика үшін керек)
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let game = {
    deck: [], playerHand: [], botHand: [], 
    table: [], // Құрылымы: [{ card: {...}, owner: 'player' }] (СЕНІҢ ФОРМАТЫҢ)
    trumpCard: null, attacker: 'player', winner: null
};

// 1. Колода жасау
function createDeck() {
    let deck = [];
    for (let s of suits) {
        for (let v of values) deck.push({ suit: s, value: v, power: power[v] });
    }
    return deck.sort(() => Math.random() - 0.5);
}

// 2. Ойынды бастау
function startGame() {
    game.deck = createDeck();
    game.trumpCard = game.deck[game.deck.length - 1]; 
    game.table = [];
    game.winner = null;
    game.playerHand = [];
    game.botHand = [];
    
    // Карта тарату
    fillHands();
    
    // Кім бастайтынын анықтау (әзірге player)
    game.attacker = 'player'; 
}

// 3. ЛОГИКА: Картаны жабуға бола ма?
function canBeat(attackCard, defenseCard) {
    if (!attackCard || !defenseCard) return false;
    // Егер масть бірдей болса -> үлкені жеңеді
    if (attackCard.suit === defenseCard.suit) return defenseCard.power > attackCard.power;
    // Егер қорғанушы козырь болса -> жеңеді
    if (defenseCard.suit === game.trumpCard.suit && attackCard.suit !== game.trumpCard.suit) return true;
    return false;
}

// 4. ЛОГИКА: Подкидной (Үстелге тастауға бола ма?)
function canToss(card) {
    if (game.table.length === 0) return true; // Бірінші жүріс
    // Үстелдегі барлық карталардың мәнін тексереміз
    return game.table.some(item => item.card.value === card.value);
}

// 5. БОТТЫҢ ЖҮРІСІ
function botTurn(socket) {
    if (game.winner) return;

    setTimeout(() => {
        // A. ЕГЕР БОТ ҚОРҒАНСА (Адам шабуылдап тұр)
        if (game.attacker === 'player') { 
            // Соңғы картаны кім тастады?
            let lastItem = game.table[game.table.length - 1];
            
            // Егер соңғы картаны адам тастаса -> Бот жабуы керек
            if (lastItem && lastItem.owner === 'player') {
                // Жаба алатын карталарды іздейміз
                let candidates = game.botHand.filter(c => canBeat(lastItem.card, c));
                // Үнемдеу үшін ең кішісін аламыз
                candidates.sort((a,b) => a.power - b.power);

                if (candidates.length > 0) {
                    let card = candidates[0];
                    game.botHand.splice(game.botHand.indexOf(card), 1);
                    game.table.push({ card: card, owner: 'bot' });
                    sendUpdate(socket);
                } else {
                    // Жаба алмаса -> Алады
                    takeCards('bot', socket);
                }
            }
        } 
        // B. ЕГЕР БОТ ШАБУЫЛДАСА
        else { 
            // 1. Егер үстел бос болса -> Кез келген картамен жүреді
            // 2. Егер үстелде карта болса (және жұп болса) -> Подкидной
            
            // Соңғы картаны бот жапты ма? (Демек кезек адамда ма?) 
            // Жоқ, attacker='bot' болса, бот тастау керек.
            
            let cardToPlay = null;

            if (game.table.length === 0) {
                // Ең кішісімен бастайды
                game.botHand.sort((a,b) => a.power - b.power);
                cardToPlay = game.botHand[0];
            } else {
                // Подкидной іздейді
                // Тек алдыңғы карта жабылған болса (яғни үстел саны жұп болса) ғана тастай алады
                // Немесе біз жай ғана лақтыра береміз бе? Дурақта жауап күту керек.
                
                let lastItem = game.table[game.table.length - 1];
                if (lastItem.owner === 'player') {
                    // Адам жапты -> Бот үстелге ұқсас карта тастай алады
                    let tossCandidates = game.botHand.filter(c => canToss(c));
                    if(tossCandidates.length > 0) {
                        tossCandidates.sort((a,b) => a.power - b.power);
                        cardToPlay = tossCandidates[0];
                    } else {
                        // Тастайтын жоқ -> Бита
                        endTurn(socket);
                        return;
                    }
                }
            }

            if (cardToPlay) {
                game.botHand.splice(game.botHand.indexOf(cardToPlay), 1);
                game.table.push({ card: cardToPlay, owner: 'bot' });
                sendUpdate(socket);
            }
        }
    }, 1000);
}

// Карта алу функциясы
function takeCards(who, socket) {
    let cards = game.table.map(item => item.card);
    game.table = []; // Үстелді тазалау

    if (who === 'player') {
        game.playerHand.push(...cards);
        // Адам алса -> Бот келесі жүрісті жасайды (Attacker ауысады)
        game.attacker = 'bot'; 
    } else {
        game.botHand.push(...cards);
        // Бот алса -> Адам келесі жүрісті жасайды
        game.attacker = 'player';
    }
    
    fillHands();
    sendUpdate(socket);
    
    // Егер кезек ботқа келсе, ол жүреді
    if (game.attacker === 'bot') botTurn(socket);
}

// Бита (Келесі раунд)
function endTurn(socket) {
    game.table = [];
    fillHands();
    // Кезек ауысады
    game.attacker = (game.attacker === 'player') ? 'bot' : 'player';
    sendUpdate(socket);
    
    if (game.attacker === 'bot') botTurn(socket);
}

function fillHands() {
    while (game.playerHand.length < 6 && game.deck.length > 0) game.playerHand.push(game.deck.pop());
    while (game.botHand.length < 6 && game.deck.length > 0) game.botHand.push(game.deck.pop());
    
    // Жеңісті тексеру
    if (game.deck.length === 0) {
        if (game.playerHand.length === 0) game.winner = 'player';
        else if (game.botHand.length === 0) game.winner = 'bot';
    }
}

// Клиентке (HTML-ге) жіберетін ақпарат
function sendUpdate(socket) {
    socket.emit('updateState', {
        playerHand: game.playerHand,
        botCardCount: game.botHand.length,
        table: game.table, // ДӘЛ СЕНІҢ HTML КҮТКЕНДЕЙ ARRAY ЖІБЕРЕМІЗ
        trumpCard: game.trumpCard,
        deckCount: game.deck.length,
        attacker: game.attacker,
        winner: game.winner
    });
}

// --- SOCKET CONNECT ---
io.on('connection', (socket) => {
    // Егер ойын басталмаса, бастаймыз
    if (game.deck.length === 0) startGame();
    
    sendUpdate(socket);

    // 1. Адам карта жүрді
    socket.on('playCard', (index) => {
        // Егер ойын бітсе немесе бот шабуылдап жатса (және мен жабуым керек болмаса) тоқта
        // Бірақ біз тексеруді төменде жасаймыз
        
        let card = game.playerHand[index];
        let isValid = false;

        // A. МЕН ШАБУЫЛДАП ЖАТЫРМЫН
        if (game.attacker === 'player') {
            // Егер үстел бос болса немесе Подкидной ережесі сәйкес келсе
            if (canToss(card) && game.table.length < 12) {
                // Тағы бір шарт: Егер үстелде карта бар болса, соңғысы БОТТЫКІ (жабылған) болуы керек
                let lastItem = game.table[game.table.length - 1];
                if (!lastItem || lastItem.owner === 'bot') {
                    isValid = true;
                }
            }
        } 
        // B. МЕН ҚОРҒАНЫП ЖАТЫРМЫН
        else {
            let lastItem = game.table[game.table.length - 1];
            // Соңғы картаны БОТ тастаса, мен жабуым керек
            if (lastItem && lastItem.owner === 'bot') {
                if (canBeat(lastItem.card, card)) {
                    isValid = true;
                }
            }
        }

        if (isValid) {
            // Қолдан өшіру
            game.playerHand.splice(index, 1);
            // Үстелге қосу
            game.table.push({ card: card, owner: 'player' });
            
            sendUpdate(socket);
            
            // Енді боттың кезегі (жауап беру немесе тастау)
            botTurn(socket);
                } else {
            // Қате болса -> "invalidMove" деген сигнал жібереміз!
            socket.emit('invalidMove');
        }

    });

    // 2. Адам "АЛУ" батырмасын басты
    socket.on('actionTake', () => {
        // Тек бот шабуылдап жатқанда ғана ала аламын
        if (game.attacker === 'bot') {
            takeCards('player', socket);
        }
    });

    // 3. Адам "БИТА" батырмасын басты
    socket.on('actionBita', () => {
        // Тек мен шабуылдап жатқанда және үстелде карта бар болса
        if (game.attacker === 'player' && game.table.length > 0) {
            // Тек соңғы карта жабылған болса (жұп саны тең болса)
            if (game.table.length % 2 === 0) {
                endTurn(socket);
            }
        }
    });

    socket.on('restart', () => {
        startGame();
        sendUpdate(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
