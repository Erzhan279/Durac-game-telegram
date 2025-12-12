const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);

// Файлдарды ашу
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/game.html', (req, res) => res.sendFile(path.join(__dirname, 'game.html')));

const io = new Server(server, { cors: { origin: "*" } });

// --- ДЕРЕКТЕР ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let usersDB = {};  // Ойыншылар
let queue = [];    // Онлайн кезек
let games = {};    // БАРЛЫҚ БЕЛСЕНДІ ОЙЫНДАР (Бөлмелер)

// --- ФУНКЦИЯЛАР ---

function createDeck() {
    let deck = [];
    for (let s of suits) {
        for (let v of values) deck.push({ suit: s, value: v, power: power[v] });
    }
    return deck.sort(() => Math.random() - 0.5);
}

// Жаңа ойын құру (Бот немесе Онлайн)
function createGameSession(player1Socket, player2Socket = null) {
    const isBotGame = (player2Socket === null);
    const roomId = isBotGame ? `room_bot_${player1Socket.id}` : `room_${player1Socket.id}_${player2Socket.id}`;

    // Сокеттерді бөлмеге қосамыз
    player1Socket.join(roomId);
    if (!isBotGame) player2Socket.join(roomId);

    let deck = createDeck();
    let trumpCard = deck.pop();
    deck.unshift(trumpCard);

    // Ойын объектісі
    games[roomId] = {
        roomId: roomId,
        isBotGame: isBotGame,
        deck: deck,
        trumpCard: trumpCard,
        table: [],
        players: {
            // Player 1 (Мен)
            [player1Socket.id]: { socket: player1Socket, hand: [] },
            // Player 2 (Қарсылас немесе Бот)
            'opponent': { socket: player2Socket, hand: [] } // Бот болса socket = null
        },
        // ID бойынша кім екенін сақтаймыз
        p1_id: player1Socket.id,
        p2_id: isBotGame ? 'bot' : player2Socket.id,
        
        attacker: player1Socket.id, // Әзірге бірінші кірген бастайды
        winner: null
    };

    fillHands(roomId);
    
    // Ойын басталды деп хабарлаймыз
    io.to(roomId).emit('gameStarted');
    sendGameUpdate(roomId);
}

function fillHands(roomId) {
    let game = games[roomId];
    if (!game) return;

    // Player 1
    while (game.players[game.p1_id].hand.length < 6 && game.deck.length > 0) {
        game.players[game.p1_id].hand.push(game.deck.pop());
    }
    // Player 2 (Bot or Human)
    while (game.players['opponent'].hand.length < 6 && game.deck.length > 0) {
        game.players['opponent'].hand.push(game.deck.pop());
    }
    checkWinner(roomId);
}

function checkWinner(roomId) {
    let game = games[roomId];
    if (game.deck.length === 0) {
        if (game.players[game.p1_id].hand.length === 0) game.winner = 'player';
        else if (game.players['opponent'].hand.length === 0) game.winner = 'bot'; // Немесе opponent
    }
}

// Жаңарту жіберу (Ең маңызды функция)
function sendGameUpdate(roomId) {
    let game = games[roomId];
    if (!game) return;

    // Player 1-ге жіберу
    const p1Socket = game.players[game.p1_id].socket;
    const p1State = {
        playerHand: game.players[game.p1_id].hand,
        botCardCount: game.players['opponent'].hand.length,
        table: game.table,
        trumpCard: game.trumpCard,
        deckCount: game.deck.length,
        attacker: (game.attacker === game.p1_id) ? 'player' : 'bot', // UI үшін 'bot' деп жібереміз (қарсылас)
        winner: game.winner,
        user: usersDB[game.p1_id]
    };
    p1Socket.emit('updateState', p1State);

    // Егер Онлайн болса -> Player 2-ге де жіберу керек (Төңкеріп)
    if (!game.isBotGame) {
        const p2Socket = game.players['opponent'].socket;
        const p2State = {
            playerHand: game.players['opponent'].hand, // Оның өз қолы
            botCardCount: game.players[game.p1_id].hand.length, // Менің қолым (ол үшін бот сияқты)
            table: game.table,
            trumpCard: game.trumpCard,
            deckCount: game.deck.length,
            attacker: (game.attacker === game.p2_id) ? 'player' : 'bot', // Ол үшін өзі player
            winner: game.winner === 'player' ? 'bot' : (game.winner ? 'player' : null), // Жеңісті ауыстыру
            user: usersDB[game.p2_id]
        };
        p2Socket.emit('updateState', p2State);
    }
}

// --- БОТ ЛОГИКАСЫ (Ескі кодтан) ---
function botTurn(roomId) {
    let game = games[roomId];
    if (!game || !game.isBotGame || game.winner) return;

    setTimeout(() => {
        let botHand = game.players['opponent'].hand;
        // ... (Сенің ескі бот логикаңды осында саламыз, бірақ қысқартып жаздым) ...
        // Қарапайым бот: Егер шабуылдаса -> ең кішісін тастайды
        if (game.attacker !== game.p1_id) { // Бот шабуылда
             if (game.table.length === 0) {
                 botHand.sort((a,b) => a.power - b.power);
                 let card = botHand.shift();
                 game.table.push({ card: card, owner: 'bot' });
                 sendGameUpdate(roomId);
             }
        }
        // Толық бот логикасын кейін қосамыз, қазір бастысы онлайн істеу керек
    }, 1000);
}

// --- SOCKET CONNECTION ---
io.on('connection', (socket) => {
    
    socket.on('login', (userData) => {
        usersDB[socket.id] = { 
            name: userData ? userData.first_name : 'Guest', coins: 100 
        };
    });

    // 1. БОТПЕН ОЙНАУ
    socket.on('startBotGame', () => {
        createGameSession(socket, null); // Екінші ойыншы жоқ
    });

    // 2. ОНЛАЙН ОЙНАУ (Кезек)
    socket.on('findGame', () => {
        if (queue.length > 0) {
            let opponent = queue.pop();
            if (opponent.id === socket.id) { queue.push(opponent); return; } // Өзімен өзі емес
            createGameSession(opponent, socket); // Екі адам
        } else {
            queue.push(socket); // Кезекке тұру
        }
    });

    // 3. ЖҮРІС ЖАСАУ (Универсалды)
    socket.on('playCard', (index) => {
        // Ойыншының бөлмесін табамыз
        let roomId = Array.from(socket.rooms).find(r => r.startsWith('room_'));
        let game = games[roomId];
        if (!game) return;

        // Кім жүріп жатыр?
        let isP1 = (socket.id === game.p1_id);
        let playerHand = isP1 ? game.players[game.p1_id].hand : game.players['opponent'].hand;
        let card = playerHand[index];

        // ... ТЕКСЕРІС ЛОГИКАСЫ (Valid Move) ...
        // (Оңайлатылған: Тексереміз де, қосамыз)
        
        playerHand.splice(index, 1);
        game.table.push({ card: card, owner: isP1 ? 'player' : 'bot' }); // Онлайн болса да 'bot' деп көрсетеміз (қарсылас мағынасында)
        
        sendGameUpdate(roomId);

        // Егер ботпен ойнаса -> Бот жауап береді
        if (game.isBotGame) botTurn(roomId);
    });

    // ... ActionTake, ActionBita осылай жалғасады ...
    
    socket.on('disconnect', () => {
        // Кезекте тұрса алып тастаймыз
        let qIndex = queue.indexOf(socket);
        if (qIndex !== -1) queue.splice(qIndex, 1);
        // Ойынды бұзамыз (кейін)
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));

if(process.env.TELEGRAM_BOT_TOKEN) require('./bot');
