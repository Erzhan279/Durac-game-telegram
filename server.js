const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const io = new Server(server, { cors: { origin: "*" } });

// --- ОЙЫН ПАРАМЕТРЛЕРІ ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
// Картаның күшін анықтау (6-дан Тузға дейін)
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let gameState = {
    deck: [],
    playerHand: [],
    botHand: [],
    table: [],
    trumpCard: null, // Козырь
    trumpSuit: null  // Козырьдың мастьі
};

// Колода жасау және араластыру
function startNewGame() {
    let deck = [];
    for (let suit of suits) {
        for (let value of values) deck.push({ suit, value, power: power[value] });
    }
    // Араластыру
    deck.sort(() => Math.random() - 0.5);

    gameState.trumpCard = deck[deck.length - 1]; // Ең соңғы карта - козырь
    gameState.trumpSuit = gameState.trumpCard.suit;

    gameState.playerHand = deck.splice(0, 6);
    gameState.botHand = deck.splice(0, 6);
    gameState.deck = deck;
    gameState.table = [];
    
    return gameState;
}

// БОТТЫҢ ЛОГИКАСЫ (МИЫ) 🧠
function botTurn(socket) {
    if (gameState.table.length === 0) return; // Үстел бос болса, бот жүрмейді

    const attackCard = gameState.table[gameState.table.length - 1]; // Сенің соңғы картаң

    // 1. Бот жауап іздейді (Үлкен карта немесе козырь)
    let defenseCardIndex = -1;

    // Алдымен қарапайым картамен жабуға тырысады
    defenseCardIndex = gameState.botHand.findIndex(c => 
        c.suit === attackCard.suit && c.power > attackCard.power
    );

    // Егер табылмаса, Козырьмен жабуға тырысады
    if (defenseCardIndex === -1 && attackCard.suit !== gameState.trumpSuit) {
        defenseCardIndex = gameState.botHand.findIndex(c => c.suit === gameState.trumpSuit);
    }

    setTimeout(() => {
        if (defenseCardIndex !== -1) {
            // БОТ ЖАПТЫ!
            const card = gameState.botHand.splice(defenseCardIndex, 1)[0];
            gameState.table.push(card);
            socket.emit('updateState', sanitizeState());
            socket.emit('message', 'Бот жапты!');
        } else {
            // БОТ АЛДЫ! (Жаба алмады)
            gameState.botHand.push(...gameState.table);
            gameState.table = [];
            socket.emit('updateState', sanitizeState());
            socket.emit('message', 'Бот карталарды алды!');
            
            // Карта жетіспесе, колодадан аламыз
            fillHands();
            socket.emit('updateState', sanitizeState());
        }
    }, 1000); // 1 секунд ойланады
}

function fillHands() {
    while (gameState.playerHand.length < 6 && gameState.deck.length > 0) {
        gameState.playerHand.push(gameState.deck.shift());
    }
    while (gameState.botHand.length < 6 && gameState.deck.length > 0) {
        gameState.botHand.push(gameState.deck.shift());
    }
}

// Клиентке тек керектіні жіберу (Боттың картасын жасыру)
function sanitizeState() {
    return {
        playerHand: gameState.playerHand,
        table: gameState.table,
        trumpCard: gameState.trumpCard,
        botCardCount: gameState.botHand.length, // Боттың картасын көрсетпейміз, тек санын айтамыз
        deckCount: gameState.deck.length
    };
}

io.on('connection', (socket) => {
    console.log('Ойыншы кірді');
    startNewGame();
    socket.emit('updateState', sanitizeState());

    // Сен карта жүргенде
    socket.on('playCard', (index) => {
        const card = gameState.playerHand.splice(index, 1)[0];
        gameState.table.push(card);
        socket.emit('updateState', sanitizeState());
        
        // Бот жауап береді
        botTurn(socket);
    });

    // Сен Бита жасағанда (Үстел тазалау)
    socket.on('actionBita', () => {
        gameState.table = [];
        fillHands(); // Карта аламыз
        socket.emit('updateState', sanitizeState());
        socket.emit('message', 'Бита! Жаңа айналым.');
    });

    // Сен карта алғанда
    socket.on('actionTake', () => {
        gameState.playerHand.push(...gameState.table);
        gameState.table = [];
        fillHands();
        socket.emit('updateState', sanitizeState());
    });
    
    // Жаңа ойын бастау
    socket.on('restart', () => {
        startNewGame();
        socket.emit('updateState', sanitizeState());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Bot Server running on port ${PORT}`);
});
