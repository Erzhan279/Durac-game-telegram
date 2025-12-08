const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const cors = require('cors'); // Егер орнатпаған болсаң: npm install cors

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Егер html файл public папкасында емес, сыртта тұрса:
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- ОЙЫН ДЕРЕКТЕРІ ---
const SUITS = ['♥', '♦', '♣', '♠'];
const VALUES = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POWER = {'6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14};

let gameState = {
    deck: [],
    trumpCard: null,
    playerHand: [],
    botHand: [],
    table: [], // Құрылымы: [{ attack: card, defend: card/null }]
    attacker: 'player', 
    winner: null
};

// 1. Колода жасау
function createDeck() {
    let deck = [];
    for (let s of SUITS) {
        for (let v of VALUES) {
            deck.push({ suit: s, value: v });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

// 2. Ойынды бастау
function startNewGame() {
    gameState.deck = createDeck();
    gameState.playerHand = [];
    gameState.botHand = [];
    gameState.table = [];
    gameState.winner = null;
    gameState.attacker = 'player'; // Әзірге адам бастайды

    // 6 картадан тарату
    for(let i=0; i<6; i++) {
        if(gameState.deck.length) gameState.playerHand.push(gameState.deck.pop());
        if(gameState.deck.length) gameState.botHand.push(gameState.deck.pop());
    }

    // Козырь (Колоданың астындағы карта)
    gameState.trumpCard = gameState.deck.length > 0 ? gameState.deck[0] : {suit: '♥', value: '6'};
}

// 3. Карта күшін тексеру (Ұра ала ма?)
function canBeat(attack, defend) {
    if (!attack || !defend) return false;
    const trump = gameState.trumpCard.suit;
    
    // Егер қорғанушы козырь болса
    if (defend.suit === trump) {
        if (attack.suit !== trump) return true; // Жай картаны козырь ұрады
        return POWER[defend.value] > POWER[attack.value]; // Үлкен козырь
    }
    
    // Егер масть бірдей болса
    if (attack.suit === defend.suit) {
        return POWER[defend.value] > POWER[attack.value];
    }

    return false; // Басқа жағдайда ұра алмайды
}

// 4. Боттың логикасы (AI)
function botAction() {
    if (gameState.winner) return;

    setTimeout(() => {
        // A. БОТ ҚОРҒАНАДЫ
        if (gameState.attacker === 'player') {
            // Жабылмаған соңғы жұпты іздейміз
            let currentPair = gameState.table[gameState.table.length - 1];
            
            if (currentPair && !currentPair.defend) {
                // Қолынан ұра алатын карта іздейді
                let candidates = gameState.botHand.filter(c => canBeat(currentPair.attack, c));
                
                if (candidates.length > 0) {
                    // Ең кішісімен ұрамыз (үнемдеу)
                    candidates.sort((a,b) => {
                         // Егер екеуі де козырь болса немесе екеуі де жай болса, күшін салыстыр
                         if (a.suit === gameState.trumpCard.suit && b.suit !== gameState.trumpCard.suit) return 1;
                         if (a.suit !== gameState.trumpCard.suit && b.suit === gameState.trumpCard.suit) return -1;
                         return POWER[a.value] - POWER[b.value];
                    });
                    
                    let bestCard = candidates[0];
                    // Қолдан өшіру
                    gameState.botHand.splice(gameState.botHand.indexOf(bestCard), 1);
                    // Үстелге қою
                    currentPair.defend = bestCard;
                    
                    io.emit('updateState', getPublicState());
                } else {
                    // Ұра алмайды -> Алады
                    handleTake('bot');
                }
            }
        } 
        // B. БОТ ШАБУЫЛДАЙДЫ
        else {
            if (gameState.table.length === 0) {
                // Ең кіші картамен жүру
                gameState.botHand.sort((a,b) => POWER[a.value] - POWER[b.value]);
                // Козырь емесін іздеуге тырысады
                let card = gameState.botHand.find(c => c.suit !== gameState.trumpCard.suit) || gameState.botHand[0];
                
                gameState.botHand.splice(gameState.botHand.indexOf(card), 1);
                gameState.table.push({ attack: card, defend: null });
                io.emit('updateState', getPublicState());
            } else {
                // Подкидной (үстелде бар мәнді тастау)
                let tableValues = new Set();
                gameState.table.forEach(p => {
                    tableValues.add(p.attack.value);
                    if(p.defend) tableValues.add(p.defend.value);
                });

                let match = gameState.botHand.find(c => tableValues.has(c.value));
                // Тек алдыңғы карта жабылған болса ғана тастайды (ереже бойынша)
                let allCovered = gameState.table.every(p => p.defend !== null);

                if (match && allCovered && gameState.table.length < 6) {
                    gameState.botHand.splice(gameState.botHand.indexOf(match), 1);
                    gameState.table.push({ attack: match, defend: null });
                    io.emit('updateState', getPublicState());
                } else {
                    if (allCovered) handleBita(); // Тастайтын жоқ -> Бита
                }
            }
        }
    }, 1000); // 1 секунд ойланады
}

function handleTake(who) {
    let allCards = [];
    gameState.table.forEach(p => {
        allCards.push(p.attack);
        if(p.defend) allCards.push(p.defend);
    });
    gameState.table = [];

    if (who === 'player') {
        gameState.playerHand.push(...allCards);
        gameState.attacker = 'bot';
    } else {
        gameState.botHand.push(...allCards);
        gameState.attacker = 'player';
    }
    fillHands();
    io.emit('updateState', getPublicState());
    
    if (gameState.attacker === 'bot') botAction();
}

function handleBita() {
    gameState.table = [];
    fillHands();
    // Кезек ауысады
    gameState.attacker = (gameState.attacker === 'player') ? 'bot' : 'player';
    io.emit('updateState', getPublicState());
    
    if (gameState.attacker === 'bot') botAction();
}

function fillHands() {
    while (gameState.playerHand.length < 6 && gameState.deck.length > 0) gameState.playerHand.push(gameState.deck.pop());
    while (gameState.botHand.length < 6 && gameState.deck.length > 0) gameState.botHand.push(gameState.deck.pop());
    checkWin();
}

function checkWin() {
    if (gameState.deck.length === 0) {
        if (gameState.playerHand.length === 0) gameState.winner = 'player';
        else if (gameState.botHand.length === 0) gameState.winner = 'bot';
    }
}

function getPublicState() {
    return {
        playerHand: gameState.playerHand,
        botCardCount: gameState.botHand.length,
        table: gameState.table,
        trumpCard: gameState.trumpCard,
        deckCount: gameState.deck.length,
        attacker: gameState.attacker,
        winner: gameState.winner
    };
}

// --- SOCKET CONNECTION ---
io.on('connection', (socket) => {
    if (gameState.deck.length === 0) startNewGame();
    socket.emit('updateState', getPublicState());

    socket.on('playCard', (index) => {
        if (gameState.winner) return;
        if (index < 0 || index >= gameState.playerHand.length) return;

        const card = gameState.playerHand[index];
        let isValid = false;

        // 1. АДАМ ШАБУЫЛДАП ТҰР
        if (gameState.attacker === 'player') {
            if (gameState.table.length === 0) {
                isValid = true;
                gameState.table.push({ attack: card, defend: null });
            } else {
                // Подкидной
                let tableValues = new Set();
                gameState.table.forEach(p => {
                    tableValues.add(p.attack.value);
                    if(p.defend) tableValues.add(p.defend.value);
                });
                
                // Тек алдыңғы жұп жабылғанда ғана тастауға болады (қатаң ереже)
                let allCovered = gameState.table.every(p => p.defend !== null);
                
                if (tableValues.has(card.value) && allCovered && gameState.table.length < 6) {
                    isValid = true;
                    gameState.table.push({ attack: card, defend: null });
                }
            }
        } 
        // 2. АДАМ ҚОРҒАНЫП ТҰР
        else {
            let currentPair = gameState.table[gameState.table.length - 1];
            if (currentPair && !currentPair.defend) {
                if (canBeat(currentPair.attack, card)) {
                    isValid = true;
                    currentPair.defend = card;
                }
            }
        }

        if (isValid) {
            gameState.playerHand.splice(index, 1);
            io.emit('updateState', getPublicState());
            checkWin();
            botAction(); // Ботқа кезек беру
        } else {
            // Қате жүріс - ештеңе істемейміз (клиент өзі қайтарады)
        }
    });

    socket.on('actionTake', () => {
        if (gameState.attacker === 'bot') handleTake('player');
    });

    socket.on('actionBita', () => {
        if (gameState.attacker === 'player') {
            // Барлығы жабылған ба?
            if (gameState.table.length > 0 && gameState.table.every(p => p.defend !== null)) {
                handleBita();
            }
        }
    });

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
