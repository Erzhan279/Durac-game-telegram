const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path'); // Жолды табу үшін керек

const app = express();
app.use(cors());

const server = http.createServer(app);

// --- МАҢЫЗДЫ ӨЗГЕРІС ОСЫ ЖЕРДЕ ---
// Біреу сайтқа кірсе, оған index.html файлын жібереміз
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// ---------------------------------

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- ОЙЫН ЛОГИКАСЫ (Ескі кодпен бірдей) ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ suit, value });
        }
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

    let deck = createDeck();
    shuffleDeck(deck);
    const playerHand = deck.splice(0, 6);

    socket.emit('dealCards', playerHand);
    
    socket.on('disconnect', () => {
        console.log('Ойыншы шығып кетті:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер жұмыс істеп тұр: http://localhost:${PORT}`);
});
