const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- ОЙЫН ЛОГИКАСЫ ОСЫ ЖЕРДЕ ---

// Карталардың түрлері мен мастьтары
const suits = ['♥', '♦', '♣', '♠']; // Черви, Буби, Крести, Пики
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']; // 6-дан Тузға дейін

// 1. Колода жасайтын функция
function createDeck() {
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ suit, value }); // Мысалы: { suit: '♥', value: '6' }
        }
    }
    return deck;
}

// 2. Араластыратын функция (Shuffle)
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Ойыншы қосылғанда не болады?
io.on('connection', (socket) => {
    console.log('Ойыншы кірді:', socket.id);

    // Жаңа колода жасап, араластырамыз
    let deck = createDeck();
    shuffleDeck(deck);

    // Ойыншыға 6 карта береміз
    const playerHand = deck.splice(0, 6);

    // Ойыншыға карталарын жібереміз
    socket.emit('dealCards', playerHand);
    
    console.log('Ойыншыға карта берілді:', playerHand);

    socket.on('disconnect', () => {
        console.log('Ойыншы шығып кетті:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер жұмыс істеп тұр: http://localhost:${PORT}`);
});
