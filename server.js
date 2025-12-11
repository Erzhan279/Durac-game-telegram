const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname))); // Түзетілген жол

const server = http.createServer(app);

// Файлдарды ашу
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html'))); // Меню
app.get('/game.html', (req, res) => res.sendFile(path.join(__dirname, 'game.html'))); // Ойын

const io = new Server(server, { cors: { origin: "*" } });

// --- ОЙЫНШЫЛАР БАЗАСЫ (Уақытша жадта) ---
// Шын жобада мұны MongoDB немесе SQLite-қа сақтау керек
let usersDB = {}; 

const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let game = {
    deck: [], playerHand: [], botHand: [], 
    table: [], trumpCard: null, attacker: 'player', winner: null,
    playerSocketId: null // Ойыншының кім екенін білу үшін
};

function createDeck() {
    let deck = [];
    for (let s of suits) {
        for (let v of values) deck.push({ suit: s, value: v, power: power[v] });
    }
    return deck.sort(() => Math.random() - 0.5);
}

function startGame() {
    game.deck = createDeck();
    game.playerHand = [];
    game.botHand = [];
    game.table = [];
    game.winner = null;
    game.trumpCard = null;

    fillHands(); 

    if (game.deck.length > 0) {
        let potentialTrump = game.deck.pop(); 
        game.trumpCard = potentialTrump;
        game.deck.unshift(potentialTrump); 
    } else {
        game.trumpCard = game.botHand[game.botHand.length - 1];
    }
    game.attacker = 'player'; 
}

function fillHands() {
    while (game.playerHand.length < 6 && game.deck.length > 0) game.playerHand.push(game.deck.pop());
    while (game.botHand.length < 6 && game.deck.length > 0) game.botHand.push(game.deck.pop());
    checkWinner();
}

// --- ЖЕҢІСТІ ЖӘНЕ ТИЫНДЫ ТЕКСЕРУ ---
function checkWinner() {
    if (game.deck.length === 0) {
        if (game.playerHand.length === 0) {
            game.winner = 'player';
            // 🔥 ЕГЕР ОЙЫНШЫ ҰТСА -> 10 ТИЫН БЕРЕМІЗ
            if (game.playerSocketId && usersDB[game.playerSocketId]) {
                usersDB[game.playerSocketId].coins += 10;
                usersDB[game.playerSocketId].wins += 1;
            }
        } else if (game.botHand.length === 0) {
            game.winner = 'bot';
        }
    }
}

function canBeat(attackCard, defenseCard) {
    if (!attackCard || !defenseCard) return false;
    if (defenseCard.suit === game.trumpCard.suit && attackCard.suit !== game.trumpCard.suit) return true;
    if (attackCard.suit === defenseCard.suit) return defenseCard.power > attackCard.power;
    return false;
}

function canToss(card) {
    if (game.table.length === 0) return true; 
    return game.table.some(item => item.card.value === card.value);
}

function botTurn(socket) {
    if (game.winner) return;

    setTimeout(() => {
        if (game.attacker === 'player') { 
            let lastItem = game.table[game.table.length - 1];
            if (lastItem && lastItem.owner === 'player') {
                let candidates = game.botHand.filter(c => canBeat(lastItem.card, c));
                candidates.sort((a,b) => a.power - b.power);

                if (candidates.length > 0) {
                    let card = candidates[0];
                    game.botHand.splice(game.botHand.indexOf(card), 1);
                    game.table.push({ card: card, owner: 'bot' });
                    sendUpdate(socket);
                    fillHands(); 
                } else {
                    takeCards('bot', socket);
                }
            }
        } else { 
            if (game.table.length === 0) {
                game.botHand.sort((a,b) => a.power - b.power);
                let card = game.botHand[0];
                game.botHand.splice(0, 1);
                game.table.push({ card: card, owner: 'bot' });
                sendUpdate(socket);
            } else {
                let lastItem = game.table[game.table.length - 1];
                if (lastItem.owner === 'player') {
                    let tossCandidates = game.botHand.filter(c => canToss(c));
                    if (tossCandidates.length > 0 && game.table.length < 12) {
                        tossCandidates.sort((a,b) => a.power - b.power);
                        let card = tossCandidates[0];
                        game.botHand.splice(game.botHand.indexOf(card), 1);
                        game.table.push({ card: card, owner: 'bot' });
                        sendUpdate(socket);
                    } else {
                        endTurn(socket);
                    }
                }
            }
        }
    }, 1000);
}

function takeCards(who, socket) {
    let cards = game.table.map(item => item.card);
    game.table = [];
    if (who === 'player') {
        game.playerHand.push(...cards);
        game.attacker = 'bot'; 
    } else {
        game.botHand.push(...cards);
        game.attacker = 'player'; 
    }
    fillHands();
    sendUpdate(socket);
    if (game.attacker === 'bot') botTurn(socket);
}

function endTurn(socket) {
    game.table = []; 
    fillHands(); 
    game.attacker = (game.attacker === 'player') ? 'bot' : 'player';
    sendUpdate(socket);
    if (game.attacker === 'bot') botTurn(socket);
}

function sendUpdate(socket) {
    checkWinner();
    
    // Ойыншының ақшасын қосып жібереміз
    let userInfo = null;
    if (game.playerSocketId && usersDB[game.playerSocketId]) {
        userInfo = usersDB[game.playerSocketId];
    }

    socket.emit('updateState', {
        playerHand: game.playerHand,
        botCardCount: game.botHand.length,
        table: game.table,
        trumpCard: game.trumpCard,
        deckCount: game.deck.length,
        attacker: game.attacker,
        winner: game.winner,
        user: userInfo // 💰 Ақша мен атын жібереміз
    });
}

// --- SOCKET ---
io.on('connection', (socket) => {
    
    // 1. ЛОГИН (Telegram-нан келген ақпаратты қабылдау)
    socket.on('login', (userData) => {
        // Егер бұл адам бұрын болмаса, тіркейміз
        // Біз ID ретінде telegram ID-ді қолданамыз, бірақ socket.id-мен байланыстырамыз
        
        let telegramId = userData ? userData.id : 'guest';
        let firstName = userData ? userData.first_name : 'Guest';

        // Базада бар ма?
        let existingUserKey = Object.keys(usersDB).find(key => usersDB[key].tgId === telegramId);
        
        if (existingUserKey) {
            // Бар болса, ескі ақшасын сақтап, жаңа socket.id береміз
            let oldData = usersDB[existingUserKey];
            delete usersDB[existingUserKey];
            usersDB[socket.id] = oldData;
        } else {
            // Жаңа болса -> 0 тиын
            usersDB[socket.id] = { 
                tgId: telegramId, 
                name: firstName, 
                coins: 0, 
                wins: 0 
            };
        }

        game.playerSocketId = socket.id;
        
        // Ойынды бастаймыз немесе жалғастырамыз
        if (game.deck.length === 0 && !game.winner) startGame();
        sendUpdate(socket);
    });

    socket.on('playCard', (index) => {
        if (game.winner) return;
        let card = game.playerHand[index];
        let isValid = false;

        if (game.attacker === 'player') {
            if (game.table.length % 2 === 0) {
                if (canToss(card) && game.table.length < 12) isValid = true;
            }
        } else {
            let lastItem = game.table[game.table.length - 1];
            if (lastItem && lastItem.owner === 'bot') {
                if (canBeat(lastItem.card, card)) isValid = true;
            }
        }

        if (isValid) {
            game.playerHand.splice(index, 1);
            game.table.push({ card: card, owner: 'player' });
            sendUpdate(socket);
            botTurn(socket);
        } else {
            socket.emit('invalidMove');
        }
    });

    socket.on('actionTake', () => {
        if (game.attacker === 'bot') takeCards('player', socket);
    });

    socket.on('actionBita', () => {
        if (game.attacker === 'player' && game.table.length > 0 && game.table.length % 2 === 0) endTurn(socket);
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
