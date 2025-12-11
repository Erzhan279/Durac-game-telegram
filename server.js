const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Статикалық файлдарды (сурет, css, js) ашуға рұқсат
app.use(express.static(__dirname)); 

const server = http.createServer(app);

// 1. БАСТЫ БЕТ (Мәзір) - index.html ашылады
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. ОЙЫН БЕТІ - game.html ашылады
app.get('/game.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});

const io = new Server(server, { cors: { origin: "*" } });

// ... (Ары қарай сенің ойын логикаң: const suits = ... деп жалғаса береді)


// --- ОЙЫН ДЕРЕКТЕРІ ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let game = {
    deck: [], playerHand: [], botHand: [], 
    table: [], 
    trumpCard: null, attacker: 'player', winner: null
};

// 1. Колода жасау (Shuffle)
function createDeck() {
    let deck = [];
    for (let s of suits) {
        for (let v of values) deck.push({ suit: s, value: v, power: power[v] });
    }
    return deck.sort(() => Math.random() - 0.5);
}

// 2. Ойынды бастау (Козырь логикасы осында)
function startGame() {
    game.deck = createDeck();
    game.playerHand = [];
    game.botHand = [];
    game.table = [];
    game.winner = null;

    // 1-қадам: Алдымен қолға 6 картадан береміз
    fillHands(); 

    // 2-қадам: Егер колодада карта қалса, козырьді анықтаймыз
    if (game.deck.length > 0) {
        // Колоданың үстінен бір карта аламыз (уақытша)
        let potentialTrump = game.deck.pop(); 
        game.trumpCard = potentialTrump;
        
        // Оны колоданың ЕҢ АСТЫНА (басына) тығамыз
        // pop() соңынан алатындықтан, unshift() басына қояды.
        // Сонда бұл карта ең соңғы болып алынады.
        game.deck.unshift(potentialTrump); 
    } else {
        // Егер карта жетпей қалса (өте сирек), соңғы карта козырь болады
        game.trumpCard = game.botHand[game.botHand.length - 1];
    }

    // Кім бастайтынын анықтау (Козырь кімде кіші болса - сол бастайды)
    // Әзірге қарапайым болу үшін player бастайды деп қоямыз
    game.attacker = 'player'; 
}

// 3. Қолды толтыру
function fillHands() {
    // Ойыншыға 6 картаға дейін береміз
    while (game.playerHand.length < 6 && game.deck.length > 0) {
        game.playerHand.push(game.deck.pop()); // pop() соңынан (үстінен) алады
    }
    // Ботқа 6 картаға дейін береміз
    while (game.botHand.length < 6 && game.deck.length > 0) {
        game.botHand.push(game.deck.pop());
    }
    
    checkWinner();
}

// 4. Жеңісті тексеру
function checkWinner() {
    if (game.deck.length === 0) {
        if (game.playerHand.length === 0) game.winner = 'player';
        else if (game.botHand.length === 0) game.winner = 'bot';
    }
}

// 5. Жабу логикасы
function canBeat(attackCard, defenseCard) {
    if (!attackCard || !defenseCard) return false;
    // Егер қорғанушы козырь болса, ал шабуылдаушы емес болса
    if (defenseCard.suit === game.trumpCard.suit && attackCard.suit !== game.trumpCard.suit) return true;
    // Егер масть бірдей болса
    if (attackCard.suit === defenseCard.suit) return defenseCard.power > attackCard.power;
    return false;
}

// 6. Подкидной логикасы (Үстелде бар мәнді ғана тастау)
function canToss(card) {
    if (game.table.length === 0) return true; // Үстел бос болса кез келгенін тастауға болады
    return game.table.some(item => item.card.value === card.value);
}

// 7. БОТТЫҢ ЖҮРІСІ
function botTurn(socket) {
    if (game.winner) return;

    setTimeout(() => {
        // A. БОТ ҚОРҒАНАДЫ (Attacker = Player)
        if (game.attacker === 'player') { 
            // Соңғы картаны кім тастады?
            let lastItem = game.table[game.table.length - 1];
            
            // Егер соңғы карта адамдікі болса (шабуыл), бот жабу керек
            if (lastItem && lastItem.owner === 'player') {
                // Жаба алатын карталарды іздейміз
                let candidates = game.botHand.filter(c => canBeat(lastItem.card, c));
                // Үнемдеу үшін ең кішісін таңдаймыз
                candidates.sort((a,b) => a.power - b.power);

                if (candidates.length > 0) {
                    // Жабады
                    let card = candidates[0];
                    game.botHand.splice(game.botHand.indexOf(card), 1);
                    game.table.push({ card: card, owner: 'bot' });
                    sendUpdate(socket);
                    fillHands(); // Қолды толтыру (қажет болса)
                } else {
                    // Жаба алмаса -> Алады
                    takeCards('bot', socket);
                }
            }
        } 
        // B. БОТ ШАБУЫЛДАЙДЫ (Attacker = Bot)
        else { 
            // Егер үстел бос болса
            if (game.table.length === 0) {
                // Ең кіші картамен жүреді
                game.botHand.sort((a,b) => a.power - b.power);
                let card = game.botHand[0];
                game.botHand.splice(0, 1);
                game.table.push({ card: card, owner: 'bot' });
                sendUpdate(socket);
            } 
            else {
                // Үстел бос емес, бот карта қоса ала ма? (Подкидной)
                let lastItem = game.table[game.table.length - 1];
                
                // Егер соңғы картаны адам жапса (owner='player') -> Бот тағы қоса алады
                if (lastItem.owner === 'player') {
                    let tossCandidates = game.botHand.filter(c => canToss(c));
                    if (tossCandidates.length > 0 && game.table.length < 12) {
                        tossCandidates.sort((a,b) => a.power - b.power);
                        let card = tossCandidates[0];
                        game.botHand.splice(game.botHand.indexOf(card), 1);
                        game.table.push({ card: card, owner: 'bot' });
                        sendUpdate(socket);
                    } else {
                        // Қосатын карта жоқ -> Бита
                        endTurn(socket);
                    }
                }
            }
        }
    }, 1000);
}

// Карта алу
function takeCards(who, socket) {
    let cards = game.table.map(item => item.card);
    game.table = [];

    if (who === 'player') {
        game.playerHand.push(...cards);
        game.attacker = 'bot'; // Адам алса, келесіде бот шабуылдайды
    } else {
        game.botHand.push(...cards);
        game.attacker = 'player'; // Бот алса, келесіде адам шабуылдайды
    }
    
    fillHands();
    sendUpdate(socket);
    
    // Егер ендігі кезек ботқа тисе, ол бірден жүруі керек
    if (game.attacker === 'bot') botTurn(socket);
}

// Бита (Turn аяқталу)
function endTurn(socket) {
    game.table = []; // Карталар битаға кетеді (жойылады)
    fillHands(); // Екі жақ та карта алады
    
    // Кезек ауысады
    game.attacker = (game.attacker === 'player') ? 'bot' : 'player';
    
    sendUpdate(socket);
    
    // Егер кезек ботқа келсе
    if (game.attacker === 'bot') botTurn(socket);
}

function sendUpdate(socket) {
    checkWinner();
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

// --- SOCKET CONNECT ---
io.on('connection', (socket) => {
    // Жаңа ойын бастау (егер басталмаған болса)
    if (game.deck.length === 0 && !game.winner) startGame();
    
    sendUpdate(socket);

    // 1. Адам карта жүрді
    socket.on('playCard', (index) => {
        if (game.winner) return;
        
        // Индекстің дұрыстығын тексеру
        if (index < 0 || index >= game.playerHand.length) return;

        let card = game.playerHand[index];
        let isValid = false;

        // A. МЕН ШАБУЫЛДАП ЖАТЫРМЫН
        if (game.attacker === 'player') {
            // Егер үстел бос болса НЕМЕСЕ үстелдегі карталарға сәйкес келсе (Подкидной)
            // ЖӘНЕ үстелдегі карта саны жұп болса (яғни бот жауып қойған кезде немесе басында)
            if (game.table.length % 2 === 0) {
                if (canToss(card) && game.table.length < 12) {
                    isValid = true;
                }
            }
        } 
        // B. МЕН ҚОРҒАНЫП ЖАТЫРМЫН
        else {
            let lastItem = game.table[game.table.length - 1];
            // Соңғы картаны БОТ тастады ма?
            if (lastItem && lastItem.owner === 'bot') {
                // Мен жаба аламын ба?
                if (canBeat(lastItem.card, card)) {
                    isValid = true;
                }
            }
        }

        if (isValid) {
            // Картаны қолдан өшіру
            game.playerHand.splice(index, 1);
            // Үстелге қосу
            game.table.push({ card: card, owner: 'player' });
            
            sendUpdate(socket);
            
            // Енді бот ойланады
            botTurn(socket);
        } else {
            // Қате жүріс
            socket.emit('invalidMove');
        }
    });

    // 2. "АЛУ" батырмасы
    socket.on('actionTake', () => {
        // Тек мен қорғанып жатсам ғана ала аламын
        if (game.attacker === 'bot') {
            takeCards('player', socket);
        }
    });

    // 3. "БИТА" батырмасы
    socket.on('actionBita', () => {
        // Тек мен шабуылдап жатсам ЖӘНЕ үстелде карта болса (және бот жауып қойса)
        if (game.attacker === 'player' && game.table.length > 0) {
            // Соңғы картаны бот жапқан болуы керек (table.length жұп)
            if (game.table.length % 2 === 0) {
                endTurn(socket);
            }
        }
    });

    // Қайта бастау
    socket.on('restart', () => {
        startGame();
        sendUpdate(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
