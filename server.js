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

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Ойын деректері
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
let tableCards = []; // Үстелде жатқан карталар

function createDeck() {
    let deck = [];
    for (let suit of suits) {
        for (let value of values) deck.push({ suit, value });
    }
    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

io.on('connection', (socket) => {
    console.log('Ойыншы кірді:', socket.id);

    // Жаңа адам кіргенде, үстелдегі карталарды көрсету
    socket.emit('updateTable', tableCards);

    // Карта тарату
    let deck = createDeck();
    shuffleDeck(deck);
    socket.emit('dealCards', deck.splice(0, 6));

    // --- МАҢЫЗДЫ: Ойыншы карта лақтырғанда ---
    socket.on('playCard', (card) => {
        console.log('Карта түсті:', card);
        tableCards.push(card); // Үстелге қосамыз
        io.emit('updateTable', tableCards); // Барлық адамға көрсетеміз
    });

    // Үстелді тазалау (Тест үшін)
    socket.on('clearTable', () => {
        tableCards = [];
        io.emit('updateTable', tableCards);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
