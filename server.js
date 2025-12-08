const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SUITS = ['♥', '♦', '♣', '♠'];
const VALUES = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POWER = {'6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14};

let game = {
    deck: [], playerHand: [], botHand: [], table: [], 
    trumpCard: null, attacker: 'player', winner: null
};

function createDeck() {
    let deck = [];
    for (let s of SUITS) {
        for (let v of VALUES) deck.push({ suit: s, value: v });
    }
    return deck.sort(() => Math.random() - 0.5);
}

function startGame() {
    game.deck = createDeck();
    game.trumpCard = game.deck[game.deck.length - 1]; 
    game.table = [];
    game.winner = null;
    game.playerHand = [];
    game.botHand = [];
    
    // Карта тарату (Анимация болу үшін біртіндеп берген дұрыс болар еді, бірақ әзірге осылай)
    for(let i=0; i<6; i++) {
        game.playerHand.push(game.deck.pop());
        game.botHand.push(game.deck.pop());
    }
    game.attacker = 'player';
}

// ТЕКСЕРУ: Жабуға бола ма?
function canBeat(attack, defend) {
    if (!attack || !defend) return false;
    const trump = game.trumpCard.suit;
    if (defend.suit === trump) {
        if (attack.suit !== trump) return true;
        return POWER[defend.value] > POWER[attack.value];
    }
    if (attack.suit === defend.suit) {
        return POWER[defend.value] > POWER[attack.value];
    }
    return false;
}

// ТЕКСЕРУ: Подкинуть етуге бола ма?
function canToss(card) {
    if (game.table.length === 0) return true; // Бірінші жүріс - кез келген
    let tableCards = [];
    game.table.forEach(pair => {
        tableCards.push(pair.attack);
        if (pair.defend) tableCards.push(pair.defend);
    });
    return tableCards.some(c => c.value === card.value);
}

function botTurn(socket) {
    if (game.winner) return;
    setTimeout(() => {
        // 1. БОТ ҚОРҒАНАДЫ
        if (game.attacker === 'player') {
            let lastPair = game.table[game.table.length - 1];
            if (lastPair && !lastPair.defend) {
                // Ұра алатын карта іздейді
                let candidates = game.botHand.filter(c => canBeat(lastPair.attack, c));
                if (candidates.length > 0) {
                    // Ең кішісімен ұрады
                    candidates.sort((a,b) => {
                        let isA = a.suit === game.trumpCard.suit;
                        let isB = b.suit === game.trumpCard.suit;
                        if (isA && !isB) return 1;
                        if (!isA && isB) return -1;
                        return POWER[a.value] - POWER[b.value];
                    });
                    let best = candidates[0];
                    game.botHand.splice(game.botHand.indexOf(best), 1);
                    lastPair.defend = best;
                    sendUpdate(socket);
                } else {
                    takeCards('bot', socket); // Алады
                }
            }
        } 
        // 2. БОТ ШАБУЫЛДАЙДЫ
        else {
            // Подкинуть
            let candidates = game.botHand.filter(c => canToss(c));
            // Барлық жұптар жабылды ма?
            let allCovered = game.table.every(p => p.defend !== null);

            if (candidates.length > 0 && (game.table.length === 0 || (allCovered && game.table.length < 6))) {
                // Ең кішісін тастайды
                candidates.sort((a,b) => POWER[a.value] - POWER[b.value]);
                let card = candidates[0];
                game.botHand.splice(game.botHand.indexOf(card), 1);
                game.table.push({ attack: card, defend: null });
                sendUpdate(socket);
            } else {
                if (game.table.length > 0 && allCovered) endTurn(socket); // Бита
            }
        }
    }, 1000);
}

function takeCards(who, socket) {
    let cards = [];
    game.table.forEach(p => {
        cards.push(p.attack);
        if (p.defend) cards.push(p.defend);
    });
    game.table = [];
    if (who === 'player') game.playerHand.push(...cards);
    else game.botHand.push(...cards);
    
    fillHands();
    // Ереже: Кім алса, сол келесі жүрісті жібереді (шабуылшы өзгермейді)
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

function fillHands() {
    while (game.playerHand.length < 6 && game.deck.length > 0) game.playerHand.push(game.deck.pop());
    while (game.botHand.length < 6 && game.deck.length > 0) game.botHand.push(game.deck.pop());
    
    if (game.deck.length === 0 && game.playerHand.length === 0) game.winner = 'player';
    if (game.deck.length === 0 && game.botHand.length === 0) game.winner = 'bot';
}

function sendUpdate(socket) {
    socket.emit('updateState', {
        playerHand: game.playerHand,
        botCardCount: game.botHand.length,
        table: game.table,
        trumpCard: game.trumpCard,
        deckCount: game.deck.length,
        attacker: game.attacker,
        winner: game.winner
    });
}

io.on('connection', (socket) => {
    if(game.deck.length === 0) startGame(); // Ойын жоқ болса бастау
    sendUpdate(socket);

    socket.on('playCard', (index) => {
        if (game.attacker === 'bot' && game.table.every(p => p.defend !== null)) return; // Кезек емес

        const card = game.playerHand[index];
        let isValid = false;

        // 1. ШАБУЫЛ (Подкинуть)
        if (game.attacker === 'player') {
            if (canToss(card)) {
                // Тек алдыңғы карта жабылғанда ғана тастауға болады (немесе бос болса)
                if (game.table.length === 0 || game.table.every(p => p.defend !== null)) {
                    isValid = true;
                    game.table.push({ attack: card, defend: null });
                }
            }
        } 
        // 2. ҚОРҒАНЫС (Жабу)
        else {
            let lastPair = game.table[game.table.length - 1];
            if (lastPair && !lastPair.defend) {
                if (canBeat(lastPair.attack, card)) {
                    isValid = true;
                    lastPair.defend = card;
                }
            }
        }

        if (isValid) {
            game.playerHand.splice(index, 1);
            sendUpdate(socket);
            botTurn(socket);
        } else {
            socket.emit('invalidMove'); // Қате жүріс сигналы
        }
    });

    socket.on('actionTake', () => { if(game.attacker === 'bot') takeCards('player', socket); });
    socket.on('actionBita', () => { if(game.attacker === 'player') endTurn(socket); });
    socket.on('restart', () => { startGame(); sendUpdate(socket); });
});

server.listen(process.env.PORT || 3000);
