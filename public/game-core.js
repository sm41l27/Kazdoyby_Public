const BOARD_ROWS = 12; const BOARD_COLS = 12;
const ROW_MAP = {}; for (let i = 1; i <= BOARD_ROWS; i++) { ROW_MAP[i] = BOARD_ROWS - i; }
const COL_MAP = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'N': 8, 'P': 9, 'S': 10, 'T': 11 };
const colLabels = Object.keys(COL_MAP);
const rowLabels = Array.from({length: BOARD_ROWS}, (_, i) => BOARD_ROWS - i);
const OOB_SQUARES = [ [ROW_MAP[1], COL_MAP['A']], [ROW_MAP[2], COL_MAP['A']], [ROW_MAP[1], COL_MAP['B']], [ROW_MAP[1], COL_MAP['S']], [ROW_MAP[1], COL_MAP['T']], [ROW_MAP[2], COL_MAP['T']], [ROW_MAP[12], COL_MAP['A']], [ROW_MAP[11], COL_MAP['A']], [ROW_MAP[12], COL_MAP['B']], [ROW_MAP[12], COL_MAP['S']], [ROW_MAP[11], COL_MAP['T']], [ROW_MAP[12], COL_MAP['T']] ];
const STARTING_POSITIONS = {
    'blue': [ [ROW_MAP[1], COL_MAP['C']], [ROW_MAP[1], COL_MAP['E']], [ROW_MAP[1], COL_MAP['G']], [ROW_MAP[1], COL_MAP['N']], [ROW_MAP[2], COL_MAP['D']], [ROW_MAP[2], COL_MAP['F']], [ROW_MAP[2], COL_MAP['H']], [ROW_MAP[2], COL_MAP['P']] ],
    'black': [ [ROW_MAP[4], COL_MAP['T']], [ROW_MAP[6], COL_MAP['T']], [ROW_MAP[8], COL_MAP['T']], [ROW_MAP[10], COL_MAP['T']], [ROW_MAP[3], COL_MAP['S']], [ROW_MAP[5], COL_MAP['S']], [ROW_MAP[7], COL_MAP['S']], [ROW_MAP[9], COL_MAP['S']] ],
    'red': [ [ROW_MAP[12], COL_MAP['P']], [ROW_MAP[12], COL_MAP['H']], [ROW_MAP[12], COL_MAP['F']], [ROW_MAP[12], COL_MAP['D']], [ROW_MAP[11], COL_MAP['N']], [ROW_MAP[11], COL_MAP['G']], [ROW_MAP[11], COL_MAP['E']], [ROW_MAP[11], COL_MAP['C']] ],
    'white': [ [ROW_MAP[3], COL_MAP['A']], [ROW_MAP[5], COL_MAP['A']], [ROW_MAP[7], COL_MAP['A']], [ROW_MAP[9], COL_MAP['A']], [ROW_MAP[4], COL_MAP['B']], [ROW_MAP[6], COL_MAP['B']], [ROW_MAP[8], COL_MAP['B']], [ROW_MAP[10], COL_MAP['B']] ]
};
const PAWN_FORWARD_MOVES = { 'blue': [[-1, -1], [-1, 1]], 'black': [[-1, -1], [1, -1]], 'red': [[1, -1], [1, 1]], 'white': [[-1, 1], [1, 1]] };
const ALL_DIRECTIONS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const PROMOTION_LINES = { 'blue':0, 'black':0, 'red':11, 'white':11 };
const TURN_ORDER = ['blue','black','red','white'];
const PLAYER_LABELS = { blue: 'Көк', black: 'Қара', red: 'Қызыл', white: 'Ақ' };
const TIME_CONTROLS = {
    180: { key: 'bullet-3', label: '⚡ Пуля', minutes: 3 },
    300: { key: 'blitz-5', label: '🔥 Блиц', minutes: 5 },
    600: { key: 'rapid-10', label: '⏱ Рапид', minutes: 10 },
    900: { key: 'rapid-15', label: '⏱ Рапид', minutes: 15 }
};
const SCORE_WEIGHTS = { remainingPawn: 1, remainingSultan: 2, capturedPawn: 1, capturedSultan: 2 };
function normalizeTimeControl(value) {
    const sec = Number(value);
    return TIME_CONTROLS[sec] ? sec : 600;
}
function emptyCaptureStats() {
    return TURN_ORDER.reduce((out, color) => { out[color] = { pawns: 0, sultans: 0 }; return out; }, {});
}
function syncTimeControlButtons(seconds, disabled = null) {
    const sec = normalizeTimeControl(seconds);
    const select = document.getElementById('timeControl');
    if (select) {
        select.value = String(sec);
        if (disabled !== null) select.disabled = !!disabled;
    }
    document.querySelectorAll('.time-choice').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.seconds) === sec);
        if (disabled !== null) btn.disabled = !!disabled;
    });
    return sec;
}
function selectedTimeControl() {
    return normalizeTimeControl(document.getElementById('timeControl')?.value || 600);
}


const TEAM_MAP = {
    blue: 'blue-black',
    black: 'blue-black',
    red: 'red-white',
    white: 'red-white'
};
const TEAM_LABELS = {
    'blue-black': 'Көк + Қара',
    'red-white': 'Қызыл + Ақ'
};

// Текущий режим нужен общим функциям генерации ходов и AI-поиска.
// При загрузке сохранения он синхронизируется с game.gameMode.
let CURRENT_GAME_MODE = 'ffa';

function isTeamMode() {
    return CURRENT_GAME_MODE === 'teams';
}

function getTeamId(player) {
    return TEAM_MAP[player] || player;
}

function areAllies(playerA, playerB) {
    if (playerA === playerB) return true;
    return isTeamMode() && getTeamId(playerA) === getTeamId(playerB);
}

function areEnemies(playerA, playerB) {
    return !areAllies(playerA, playerB);
}

function getActiveSides(activePlayers) {
    if (!isTeamMode()) return [...activePlayers];
    return [...new Set(activePlayers.map(getTeamId))];
}

function isTerminalActivePlayers(activePlayers) {
    return getActiveSides(activePlayers).length <= 1;
}

function getWinnerLabel(activePlayers) {
    const sides = getActiveSides(activePlayers);
    if (sides.length !== 1) return null;
    return isTeamMode() ? TEAM_LABELS[sides[0]] : sides[0];
}

function getTeamMembers(player) {
    if (!isTeamMode()) return [player];
    const teamId = getTeamId(player);
    return TURN_ORDER.filter(p => getTeamId(p) === teamId);
}

function getPartner(player) {
    if (!isTeamMode()) return null;
    return getTeamMembers(player).find(p => p !== player) || null;
}

class Piece {
    constructor(row,col,player){ this.row=row; this.col=col; this.player=player; this.isSultan=false; }
    promote(){ this.isSultan=true; }
}

// ==================== AI CONSTANTS & EVALUATION WEIGHTS ====================
const EVAL_WEIGHTS = {
    PAWN_VALUE: 100,
    SULTAN_VALUE: 320,
    ADVANCEMENT_WEIGHT: 8,
    PROMOTION_NEAR_BONUS: 50,
    CENTER_CONTROL_WEIGHT: 8,
    EDGE_SAFETY_WEIGHT: 10,
    PROTECTED_BONUS: 12,
    PAWN_THREAT_PENALTY: -50,
    SULTAN_THREAT_PENALTY: -220,
    CAPTURE_BASE_BONUS: 35,
    CHAIN_CAPTURE_BONUS: 90,
    MOBILITY_WEIGHT: 4,
    OPPONENT_PAWN_WEIGHT: 95,
    OPPONENT_SULTAN_WEIGHT: 300
};

// Дополнительная оценка только для командного режима.
// Оба цвета одной команды получают одну общую цель.
const TEAM_AI_WEIGHTS = {
    BOTH_MEMBERS_ALIVE_BONUS: 420,
    MEMBER_ALIVE_BONUS: 260,
    WEAKEST_MEMBER_PIECE: 52,
    MEMBER_NO_MOVES_PENALTY: 240,
    THREATENED_PAWN: 150,
    THREATENED_SULTAN: 430,
    ATTACK_PRESSURE_FACTOR: 0.38,
    DEFENSE_PRESSURE_FACTOR: 1.18,
    CROSS_COLOR_SUPPORT: 14,
    SAVE_PARTNER_ATTACKER_BONUS: 5200,
    SUPPORT_THREATENED_PARTNER_BONUS: 1250,
    SUPPORT_PARTNER_BONUS: 280,
    ABANDON_PARTNER_SUPPORT_PENALTY: 360
};

// Iterative search is bounded by elapsed time; depth is a ceiling, not a guarantee.
const AI_SEARCH_CONFIG = {
    easy: {
        maxDepth: Math.round(Math.pow(2, 1.5)),   // 3
        timeLimitMs: 180,
        randomMargin: 28,
        beamSchedule: [
            { maxPly: 99, width: 4 }
        ]
    },
    medium: {
        maxDepth: Math.round(Math.pow(2, 2.5)),   // 6
        timeLimitMs: 650,
        randomMargin: 8,
        beamSchedule: [
            { maxPly: 3, width: 4 },
            { maxPly: 99, width: 2 }
        ]
    },
    hard: {
        maxDepth: Math.round(Math.pow(2, 4)),     // 16
        timeLimitMs: 1400,
        randomMargin: 0,
        beamSchedule: [
            { maxPly: 4, width: 3 },
            { maxPly: 8, width: 2 },
            { maxPly: 99, width: 1 }
        ]
    }
};

const PLAYER_INDEX = { blue: 0, black: 1, red: 2, white: 3 };
const PLAYER_HASH_CODE = { blue: 'U', black: 'K', red: 'R', white: 'W' };
const AI_TIMEOUT = { timeout: true };
let AI_WORK_DEADLINE = Infinity;
function checkWorkDeadline() { if (aiNow() >= AI_WORK_DEADLINE) throw AI_TIMEOUT; }
const aiNow = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ЛОГИКИ ИИ ====================
function isValidPos(r, c) { 
    return r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS && !OOB_SQUARES.some(([rr, cc]) => rr === r && cc === c); 
}

function getPieceBoard(board, r, c) { 
    return isValidPos(r, c) ? board[r][c] : null; 
}

function findCapturesForPieceBoard(board, piece, capturedInSeq) {
    const moves = {};
    const dfs = (r, c, path, capSet) => {
        checkWorkDeadline();
        let found = false;
        if (piece.isSultan) {
            for (const [dr, dc] of ALL_DIRECTIONS) {
                let jumped = null;
                for (let i = 1; i < BOARD_ROWS; i++) {
                    const nr = r + i * dr, nc = c + i * dc;
                    if (!isValidPos(nr, nc)) break;
                    const pc = (nr === piece.row && nc === piece.col) ? null : getPieceBoard(board, nr, nc);
                    if (pc) {
                        const k = `${nr},${nc}`;
                        if (capSet.has(k) || areAllies(pc.player, piece.player)) break;
                        if (!jumped) { jumped = [nr, nc]; continue; }
                        if (jumped) break;
                    }
                    if (jumped) {
                        found = true;
                        const newSet = new Set(capSet); newSet.add(`${jumped[0]},${jumped[1]}`);
                        dfs(nr, nc, [...path, [nr, nc]], newSet);
                    }
                }
            }
        } else {
            for (const [dr, dc] of ALL_DIRECTIONS) {
                const jr = r + dr, jc = c + dc; const lr = r + 2 * dr, lc = c + 2 * dc;
                if (!isValidPos(lr, lc)) continue;
                const jp = getPieceBoard(board, jr, jc);
                const lp = (lr === piece.row && lc === piece.col) ? null : getPieceBoard(board, lr, lc);
                const jumpedKey = `${jr},${jc}`;
                if (jp && areEnemies(jp.player, piece.player) && !capSet.has(jumpedKey) && !lp) {
                    found = true;
                    const newSet = new Set(capSet); newSet.add(jumpedKey);
                    dfs(lr, lc, [...path, [lr, lc]], newSet);
                }
            }
        }
        if (!found && path.length > 1) {
            const last = path[path.length - 1];
            const key = `${last[0]},${last[1]}`;

            const allJumped = Array.from(capSet)
                .filter(s => !capturedInSeq.has(s))
                .map(s => s.split(',').map(Number));

            // Полный последовательный маршрут приземлений после каждого взятия.
            // Свойство добавляется прямо к массиву, поэтому существующий код,
            // использующий jumped.length и перебор jumped, продолжает работать.
            allJumped.path = path.slice(1).map(([pr, pc]) => [pr, pc]);

            if (!(key in moves) || allJumped.length > moves[key].length) {
                moves[key] = allJumped;
            }
        }
    };
    dfs(piece.row, piece.col, [[piece.row, piece.col]], new Set([...capturedInSeq]));
    return moves;
}

function findSimpleMovesForPieceBoard(board, piece) {
    const moves = {};
    if (piece.isSultan) {
        for (const [dr, dc] of ALL_DIRECTIONS) {
            for (let i = 1; i < BOARD_ROWS; i++) {
                const r = piece.row + i * dr, c = piece.col + i * dc;
                if (!isValidPos(r, c)) break;
                if (getPieceBoard(board, r, c) === null) moves[`${r},${c}`] = []; else break;
            }
        }
    } else {
        for (const [dr, dc] of PAWN_FORWARD_MOVES[piece.player]) {
            const r = piece.row + dr, c = piece.col + dc;
            if (isValidPos(r, c) && getPieceBoard(board, r, c) === null) { moves[`${r},${c}`] = []; }
        }
    }
    return moves;
}

function canPieceBeCaptured(board, piece) {
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = board[r][c];
            if (p && areEnemies(p.player, piece.player)) {
                const caps = findCapturesForPieceBoard(board, p, new Set());
                for (const jumped of Object.values(caps)) {
                    for (const [jr, jc] of jumped) { if (jr === piece.row && jc === piece.col) return true; }
                }
            }
        }
    }
    return false;
}

function isPieceProtected(board, piece) {
    if (piece.row === 0 || piece.row === 11 || piece.col === 0 || piece.col === 11) return true;
    const rearDirs = {
        'blue': [[1, -1], [1, 1]],
        'black': [[-1, 1], [1, 1]],
        'red': [[-1, -1], [-1, 1]],
        'white': [[-1, -1], [1, -1]]
    }[piece.player] || ALL_DIRECTIONS;

    for (const [dr, dc] of rearDirs) {
        const nr = piece.row + dr, nc = piece.col + dc;
        if (isValidPos(nr, nc)) {
            const neighbor = board[nr][nc];
            if (neighbor && areAllies(neighbor.player, piece.player)) return true;
        }
    }
    return false;
}

function getAllPossibleMovesForPlayer(board, player) {
    checkWorkDeadline();
    const moves = []; 
    let maxCapCount = 0;

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = board[r][c];
            if (p && p.player === player) {
                const caps = findCapturesForPieceBoard(board, p, new Set());
                for (const [landKey, jumped] of Object.entries(caps)) {
                    if (jumped.length > maxCapCount) { maxCapCount = jumped.length; }
                    const [nr, nc] = landKey.split(',').map(Number);
                    moves.push({
                        from: [r, c],
                        to: [nr, nc],
                        captures: jumped,
                        path: jumped.path ? jumped.path.map(([pr, pc]) => [pr, pc]) : [[nr, nc]],
                        piece: p
                    });
                }
            }
        }
    }

    if (maxCapCount > 0) {
        return moves.filter(m => m.captures.length === maxCapCount);
    }

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = board[r][c];
            if (p && p.player === player) {
                const simple = findSimpleMovesForPieceBoard(board, p);
                for (const key of Object.keys(simple)) {
                    const [nr, nc] = key.split(',').map(Number);
                    moves.push({ from: [r, c], to: [nr, nc], captures: [], piece: p });
                }
            }
        }
    }
    return moves;
}

function cloneBoard(board) {
    const newBoard = Array.from({length: BOARD_ROWS}, () => Array(BOARD_COLS).fill(null));
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = board[r][c];
            if (p) { const np = new Piece(r, c, p.player); np.isSultan = p.isSultan; newBoard[r][c] = np; }
        }
    }
    return newBoard;
}

function applyMoveToBoard(board, move, playerCounts) {
    const newBoard = cloneBoard(board); 
    const newCounts = {...playerCounts};
    const [fr, fc] = move.from; const [tr, tc] = move.to;
    const p = newBoard[fr][fc]; 
    if (!p) return {board: newBoard, counts: newCounts};
    
    newBoard[fr][fc] = null; p.row = tr; p.col = tc; newBoard[tr][tc] = p;
    for (const [cr, cc] of move.captures) {
        const captured = newBoard[cr][cc];
        if (captured) { newCounts[captured.player]--; newBoard[cr][cc] = null; }
    }
    if (!p.isSultan) {
        const pl = p.player;
        if (((pl === 'blue' || pl === 'red') && p.row === PROMOTION_LINES[pl]) ||
            ((pl === 'black' || pl === 'white') && p.col === PROMOTION_LINES[pl])) { p.isSultan = true; }
    }
    return {board: newBoard, counts: newCounts};
}

function getNextActivePlayer(turnIndex, activePlayers) {
    let next = (turnIndex + 1) % TURN_ORDER.length; let safety = 0;
    while (safety < 10) {
        const candidate = TURN_ORDER[next];
        if (activePlayers.includes(candidate)) return {player: candidate, index: next};
        next = (next + 1) % TURN_ORDER.length; safety++;
    }
    return null;
}

function getBoardHash(board, turnIndex) {
    let hash = turnIndex + ":";
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = board[r][c];
            if (p) {
                // Уникальный код цвета: раньше blue и black оба давали "b",
                // что создавало ложные совпадения в таблице транспозиций.
                hash += `${r},${c},${PLAYER_HASH_CODE[p.player]}${p.isSultan ? 'S' : 'P'};`;
            }
        }
    }
    return hash;
}

// ==================== ОЦЕНОЧНАЯ ФУНКЦИЯ (EVALUATE POSITION) ====================
function evaluatePosition(board, aiPlayer, playerCounts) {
    const friendlyPlayers = getTeamMembers(aiPlayer);
    const enemyPlayers = TURN_ORDER.filter(p => !areAllies(p, aiPlayer));

    const friendlyCount = friendlyPlayers.reduce((sum, p) => sum + (playerCounts[p] || 0), 0);
    const enemyCount = enemyPlayers.reduce((sum, p) => sum + (playerCounts[p] || 0), 0);

    if (friendlyCount <= 0) return -100000;
    if (enemyCount <= 0) return 100000;

    let score = 0;

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = board[r][c];
            if (!p) continue;

            const isFriendly = areAllies(p.player, aiPlayer);
            const sign = isFriendly ? 1 : -1;

            const baseVal = p.isSultan
                ? (isFriendly ? EVAL_WEIGHTS.SULTAN_VALUE : EVAL_WEIGHTS.OPPONENT_SULTAN_WEIGHT)
                : (isFriendly ? EVAL_WEIGHTS.PAWN_VALUE : EVAL_WEIGHTS.OPPONENT_PAWN_WEIGHT);

            score += sign * baseVal;

            if (!p.isSultan) {
                const advancement = getAdvancement(p);
                score += sign * (advancement * EVAL_WEIGHTS.ADVANCEMENT_WEIGHT);
                if (advancement >= 9) {
                    score += sign * EVAL_WEIGHTS.PROMOTION_NEAR_BONUS;
                }
            }

            if (r >= 4 && r <= 7 && c >= 4 && c <= 7) {
                score += sign * EVAL_WEIGHTS.CENTER_CONTROL_WEIGHT;
            }

            if (r === 0 || r === 11 || c === 0 || c === 11) {
                score += sign * EVAL_WEIGHTS.EDGE_SAFETY_WEIGHT;
            }

            if (isPieceProtected(board, p)) {
                score += sign * EVAL_WEIGHTS.PROTECTED_BONUS;
            }

            if (canPieceBeCaptured(board, p)) {
                const threatPenalty = p.isSultan
                    ? EVAL_WEIGHTS.SULTAN_THREAT_PENALTY
                    : EVAL_WEIGHTS.PAWN_THREAT_PENALTY;
                score += sign * threatPenalty;
            }
        }
    }

    // В командном режиме компьютер оценивает возможности обоих союзников.
    for (const friendly of friendlyPlayers) {
        if ((playerCounts[friendly] || 0) <= 0) continue;

        const friendlyMoves = getAllPossibleMovesForPlayer(board, friendly);
        score += friendlyMoves.length * EVAL_WEIGHTS.MOBILITY_WEIGHT;

        if (friendlyMoves.length > 0 && friendlyMoves[0].captures && friendlyMoves[0].captures.length > 0) {
            const maxCapt = friendlyMoves[0].captures.length;
            score += maxCapt * EVAL_WEIGHTS.CAPTURE_BASE_BONUS;
            if (maxCapt > 1) score += EVAL_WEIGHTS.CHAIN_CAPTURE_BONUS;
        }

        score += (playerCounts[friendly] || 0) * 15;
    }

    return score;
}

// ==================== MAXN ДЛЯ 4 ИГРОКОВ ====================
// В отличие от обычного Minimax, каждый игрок максимизирует СВОЮ
// компоненту оценки. Это лучше соответствует игре "каждый сам за себя".

function getAdvancement(piece) {
    if (piece.player === 'blue') return 11 - piece.row;
    if (piece.player === 'red') return piece.row;
    if (piece.player === 'black') return 11 - piece.col;
    if (piece.player === 'white') return piece.col;
    return 0;
}

function teamThreatPieceValue(piece) {
    return piece && piece.isSultan
        ? TEAM_AI_WEIGHTS.THREATENED_SULTAN
        : TEAM_AI_WEIGHTS.THREATENED_PAWN;
}

// Анализируем реальные допустимые взятия. Одна и та же цель считается один раз.
function getCapturePressureFromLegalMoves(board, legalByPlayer, attackers, targets) {
    const targetSet = new Set(targets);
    const victims = new Map();

    for (const attacker of attackers) {
        const legal = legalByPlayer[attacker] || [];
        for (const move of legal) {
            if (!move.captures || move.captures.length === 0) continue;
            for (const [r, c] of move.captures) {
                const victim = board[r][c];
                if (!victim || !targetSet.has(victim.player)) continue;
                const key = `${r},${c}`;
                const value = teamThreatPieceValue(victim);
                if (!victims.has(key) || victims.get(key) < value) victims.set(key, value);
            }
        }
    }

    let value = 0;
    for (const v of victims.values()) value += v;
    return { value, victims };
}

function countCrossColorSupport(board, members) {
    const memberSet = new Set(members);
    let links = 0;

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const p = board[r][c];
            if (!p || !memberSet.has(p.player)) continue;

            for (const [dr, dc] of ALL_DIRECTIONS) {
                const nr = r + dr, nc = c + dc;
                if (!isValidPos(nr, nc)) continue;
                const q = board[nr][nc];
                if (q && memberSet.has(q.player) && q.player !== p.player) links++;
            }
        }
    }

    return links / 2;
}

// Быстрый анализ непосредственных угроз используется в сортировке ходов,
// чтобы защитные действия не отбрасывались beam-search слишком рано.
function getImmediateThreatInfo(board, attackerPlayers, targetPlayers) {
    const attackersSet = new Set(attackerPlayers);
    const targetsSet = new Set(targetPlayers);
    const threateningAttackers = new Set();
    const threatenedVictims = new Set();

    const register = (attacker, victim) => {
        if (!victim || !targetsSet.has(victim.player)) return;
        threateningAttackers.add(`${attacker.row},${attacker.col}`);
        threatenedVictims.add(`${victim.row},${victim.col}`);
    };

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const attacker = board[r][c];
            if (!attacker || !attackersSet.has(attacker.player)) continue;

            if (!attacker.isSultan) {
                for (const [dr, dc] of ALL_DIRECTIONS) {
                    const vr = r + dr, vc = c + dc;
                    const lr = r + 2 * dr, lc = c + 2 * dc;
                    if (!isValidPos(lr, lc)) continue;
                    const victim = getPieceBoard(board, vr, vc);
                    if (victim && targetsSet.has(victim.player) && getPieceBoard(board, lr, lc) === null) {
                        register(attacker, victim);
                    }
                }
            } else {
                for (const [dr, dc] of ALL_DIRECTIONS) {
                    let victim = null;
                    for (let step = 1; step < BOARD_ROWS; step++) {
                        const nr = r + step * dr, nc = c + step * dc;
                        if (!isValidPos(nr, nc)) break;
                        const q = getPieceBoard(board, nr, nc);

                        if (!victim) {
                            if (!q) continue;
                            if (!targetsSet.has(q.player)) break;
                            victim = q;
                            continue;
                        }

                        if (q) break;
                        register(attacker, victim);
                        break;
                    }
                }
            }
        }
    }

    return { threateningAttackers, threatenedVictims };
}

function moveTouchesPartner(board, row, col, partner) {
    if (!partner) return false;
    for (const [dr, dc] of ALL_DIRECTIONS) {
        const nr = row + dr, nc = col + dc;
        if (!isValidPos(nr, nc)) continue;
        const q = board[nr][nc];
        if (q && q.player === partner) return true;
    }
    return false;
}

function moveSupportsThreatenedPartner(board, row, col, partner, threatenedVictims) {
    if (!partner || threatenedVictims.size === 0) return false;
    for (const [dr, dc] of ALL_DIRECTIONS) {
        const nr = row + dr, nc = col + dc;
        if (threatenedVictims.has(`${nr},${nc}`)) {
            const q = getPieceBoard(board, nr, nc);
            if (q && q.player === partner) return true;
        }
    }
    return false;
}

function evaluateAllPlayersFast(board, playerCounts, activePlayers) {
    checkWorkDeadline();
    const scores = [0, 0, 0, 0];
    const ownPositional = [0, 0, 0, 0];
    const activeSet = new Set(activePlayers);

    if (isTerminalActivePlayers(activePlayers)) {
        const winner = getWinnerLabel(activePlayers);

        for (const p of TURN_ORDER) {
            const idx = PLAYER_INDEX[p];
            if (!winner) {
                scores[idx] = -1000000;
            } else if (isTeamMode()) {
                scores[idx] = TEAM_LABELS[getTeamId(p)] === winner ? 1000000 : -1000000;
            } else {
                scores[idx] = p === winner ? 1000000 : -1000000;
            }
        }
        return scores;
    }

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = board[r][c];
            if (!piece) continue;

            const idx = PLAYER_INDEX[piece.player];
            let value = piece.isSultan ? EVAL_WEIGHTS.SULTAN_VALUE : EVAL_WEIGHTS.PAWN_VALUE;

            if (!piece.isSultan) {
                const adv = getAdvancement(piece);
                value += adv * EVAL_WEIGHTS.ADVANCEMENT_WEIGHT;
                if (adv >= 9) value += EVAL_WEIGHTS.PROMOTION_NEAR_BONUS;
            }

            if (r >= 4 && r <= 7 && c >= 4 && c <= 7) value += EVAL_WEIGHTS.CENTER_CONTROL_WEIGHT;
            if (r === 0 || r === 11 || c === 0 || c === 11) value += EVAL_WEIGHTS.EDGE_SAFETY_WEIGHT;
            if (isPieceProtected(board, piece)) value += EVAL_WEIGHTS.PROTECTED_BONUS;

            ownPositional[idx] += value;
        }
    }

    const mobilityBonus = [0, 0, 0, 0];
    const legalByPlayer = {};

    for (const p of activePlayers) {
        const idx = PLAYER_INDEX[p];
        const legal = getAllPossibleMovesForPlayer(board, p);
        legalByPlayer[p] = legal;
        mobilityBonus[idx] += legal.length * EVAL_WEIGHTS.MOBILITY_WEIGHT;

        if (legal.length > 0 && legal[0].captures && legal[0].captures.length > 0) {
            const maxCapt = legal[0].captures.length;
            mobilityBonus[idx] += maxCapt * EVAL_WEIGHTS.CAPTURE_BASE_BONUS;
            if (maxCapt > 1) mobilityBonus[idx] += EVAL_WEIGHTS.CHAIN_CAPTURE_BONUS;
        }
    }

    if (isTeamMode()) {
        const teamA = ['blue', 'black'];
        const teamB = ['red', 'white'];

        const evaluateTeam = (members, enemies) => {
            let power = 0;

            for (const p of members) {
                const i = PLAYER_INDEX[p];
                const count = playerCounts[p] || 0;
                power += ownPositional[i] + mobilityBonus[i] + count * 15;

                if (count > 0) power += TEAM_AI_WEIGHTS.MEMBER_ALIVE_BONUS;

                if (activeSet.has(p) && count > 0 && (legalByPlayer[p] || []).length === 0) {
                    power -= TEAM_AI_WEIGHTS.MEMBER_NO_MOVES_PENALTY;
                }
            }

            const aliveMembers = members.filter(p => (playerCounts[p] || 0) > 0).length;
            if (aliveMembers === 2) power += TEAM_AI_WEIGHTS.BOTH_MEMBERS_ALIVE_BONUS;

            // Состояние слабейшего союзника имеет отдельный вес. ИИ теперь не может
            // считать позицию хорошей только потому, что у его собственного цвета
            // много шашек, если напарник почти уничтожен.
            const weakestCount = Math.min(...members.map(p => playerCounts[p] || 0));
            power += weakestCount * TEAM_AI_WEIGHTS.WEAKEST_MEMBER_PIECE;

            const incoming = getCapturePressureFromLegalMoves(board, legalByPlayer, enemies, members);
            const outgoing = getCapturePressureFromLegalMoves(board, legalByPlayer, members, enemies);

            power -= incoming.value * TEAM_AI_WEIGHTS.DEFENSE_PRESSURE_FACTOR;
            power += outgoing.value * TEAM_AI_WEIGHTS.ATTACK_PRESSURE_FACTOR;
            power += countCrossColorSupport(board, members) * TEAM_AI_WEIGHTS.CROSS_COLOR_SUPPORT;

            return power;
        };

        const aPower = evaluateTeam(teamA, teamB);
        const bPower = evaluateTeam(teamB, teamA);
        const aScore = aPower - bPower;
        const bScore = bPower - aPower;

        // Көк и Қара максимизируют один и тот же командный результат.
        // Қызыл и Ақ — тоже один и тот же результат своей пары.
        scores[PLAYER_INDEX.blue] = aScore;
        scores[PLAYER_INDEX.black] = aScore;
        scores[PLAYER_INDEX.red] = bScore;
        scores[PLAYER_INDEX.white] = bScore;
        return scores;
    }

    for (const p of TURN_ORDER) {
        const idx = PLAYER_INDEX[p];

        if (!activeSet.has(p) || (playerCounts[p] || 0) <= 0) {
            scores[idx] = -500000;
            continue;
        }

        let enemyTotal = 0;
        for (const enemy of activePlayers) {
            if (enemy !== p) enemyTotal += ownPositional[PLAYER_INDEX[enemy]];
        }

        scores[idx] = ownPositional[idx] + mobilityBonus[idx] - enemyTotal * 0.34 + (playerCounts[p] || 0) * 15;
    }

    return scores;
}

function isPromotionMove(move) {
    if (!move || !move.piece || move.piece.isSultan) return false;
    const pl = move.piece.player;
    if (pl === 'blue' || pl === 'red') return move.to[0] === PROMOTION_LINES[pl];
    return move.to[1] === PROMOTION_LINES[pl];
}

function moveOrderingScore(board, move, playerCounts = null) {
    let score = 0;

    if (move.captures && move.captures.length) {
        score += move.captures.length * 10000;
        for (const [r, c] of move.captures) {
            const victim = board[r][c];
            if (victim) score += victim.isSultan ? 1400 : 450;
        }
        if (move.captures.length > 1) score += 1200;
    }

    if (isPromotionMove(move)) score += 5000;

    const [tr, tc] = move.to;
    if (tr >= 4 && tr <= 7 && tc >= 4 && tc <= 7) score += 180;
    if (tr === 0 || tr === 11 || tc === 0 || tc === 11) score += 80;

    if (move.piece && !move.piece.isSultan) {
        const pseudoPiece = { player: move.piece.player, row: tr, col: tc };
        score += getAdvancement(pseudoPiece) * 25;
    }

    if (isTeamMode() && move.piece) {
        const player = move.piece.player;
        const partner = getPartner(player);
        const enemies = TURN_ORDER.filter(p => areEnemies(player, p));

        if (partner) {
            const threatInfo = getImmediateThreatInfo(board, enemies, [partner]);

            for (const [cr, cc] of move.captures || []) {
                if (threatInfo.threateningAttackers.has(`${cr},${cc}`)) {
                    score += TEAM_AI_WEIGHTS.SAVE_PARTNER_ATTACKER_BONUS;
                }
            }

            const supportedBefore = moveTouchesPartner(board, move.from[0], move.from[1], partner);
            const supportedAfter = moveTouchesPartner(board, tr, tc, partner);

            if (supportedAfter) {
                score += TEAM_AI_WEIGHTS.SUPPORT_PARTNER_BONUS;
            } else if (supportedBefore) {
                score -= TEAM_AI_WEIGHTS.ABANDON_PARTNER_SUPPORT_PENALTY;
            }

            if (moveSupportsThreatenedPartner(board, tr, tc, partner, threatInfo.threatenedVictims)) {
                score += TEAM_AI_WEIGHTS.SUPPORT_THREATENED_PARTNER_BONUS;
            }

            if (playerCounts && (playerCounts[partner] || 0) <= 3 && supportedAfter) {
                score += TEAM_AI_WEIGHTS.SUPPORT_PARTNER_BONUS;
            }
        }
    }

    return score;
}

function getBeamWidth(config, plyFromRoot, orderedMoves) {
    let width = orderedMoves.length;
    for (const step of config.beamSchedule) {
        if (plyFromRoot <= step.maxPly) {
            width = step.width;
            break;
        }
    }

    // При обязательном взятии оставляем немного больше тактических вариантов.
    const isCaptureNode = orderedMoves.length > 0 &&
        orderedMoves[0].captures &&
        orderedMoves[0].captures.length > 0;

    if (isCaptureNode) width += 2;

    return Math.max(1, Math.min(width, orderedMoves.length));
}

function orderMovesForSearch(board, moves, playerCounts = null) {
    return moves.map(move => { checkWorkDeadline(); return {move, score:moveOrderingScore(board, move, playerCounts)}; })
        .sort((a,b) => b.score-a.score).map(item => item.move);
}

function checkAiDeadline(ctx) {
    ctx.nodes++;
    if (aiNow() >= ctx.deadline) {
        throw AI_TIMEOUT;
    }
}

function maxN(board, playerCounts, turnIndex, activePlayers, depth, ctx) {
    checkAiDeadline(ctx);

    if (isTerminalActivePlayers(activePlayers) || depth <= 0) {
        return evaluateAllPlayersFast(board, playerCounts, activePlayers);
    }

    let currentPlayer = TURN_ORDER[turnIndex];

    if (!activePlayers.includes(currentPlayer)) {
        const next = getNextActivePlayer(turnIndex, activePlayers);
        if (!next) return evaluateAllPlayersFast(board, playerCounts, activePlayers);
        return maxN(board, playerCounts, next.index, activePlayers, depth, ctx);
    }

    const stateKey =
        getBoardHash(board, turnIndex) +
        `_a${activePlayers.join('.')}` +
        `_d${depth}`;

    if (ctx.tt.has(stateKey)) {
        return ctx.tt.get(stateKey);
    }

    let moves = getAllPossibleMovesForPlayer(board, currentPlayer);

    // Игрок без допустимых ходов выбывает, как и в основной логике игры.
    if (moves.length === 0) {
        const newActive = activePlayers.filter(p => p !== currentPlayer);

        if (isTerminalActivePlayers(newActive)) {
            const terminal = evaluateAllPlayersFast(board, playerCounts, newActive);
            ctx.tt.set(stateKey, terminal);
            return terminal;
        }

        const next = getNextActivePlayer(turnIndex, newActive);
        const skipped = !next
            ? evaluateAllPlayersFast(board, playerCounts, newActive)
            : maxN(board, playerCounts, next.index, newActive, depth, ctx);

        ctx.tt.set(stateKey, skipped);
        return skipped;
    }

    const ordered = orderMovesForSearch(board, moves, playerCounts);
    const plyFromRoot = ctx.iterationDepth - depth;
    const beamWidth = getBeamWidth(ctx.config, plyFromRoot, ordered);
    const candidates = ordered.slice(0, beamWidth);

    const playerIdx = PLAYER_INDEX[currentPlayer];
    let bestVector = null;
    let bestOwnScore = -Infinity;
    let bestTieScore = -Infinity;

    for (const move of candidates) {
        const result = applyMoveToBoard(board, move, playerCounts);

        // После взятия игрок с 0 шашек должен сразу считаться выбывшим.
        const childActive = activePlayers.filter(p => (result.counts[p] || 0) > 0);

        let childVector;
        if (isTerminalActivePlayers(childActive)) {
            childVector = evaluateAllPlayersFast(result.board, result.counts, childActive);
        } else {
            const next = getNextActivePlayer(turnIndex, childActive);
            childVector = !next
                ? evaluateAllPlayersFast(result.board, result.counts, childActive)
                : maxN(result.board, result.counts, next.index, childActive, depth - 1, ctx);
        }

        const ownScore = childVector[playerIdx];

        // При равной собственной оценке предпочитаем позицию,
        // где сильнейший соперник имеет меньшую оценку.
        let strongestEnemy = -Infinity;
        for (const enemy of childActive) {
            if (areEnemies(currentPlayer, enemy)) {
                strongestEnemy = Math.max(strongestEnemy, childVector[PLAYER_INDEX[enemy]]);
            }
        }
        const tieScore = strongestEnemy === -Infinity ? 0 : -strongestEnemy;

        if (
            bestVector === null ||
            ownScore > bestOwnScore ||
            (ownScore === bestOwnScore && tieScore > bestTieScore)
        ) {
            bestVector = childVector;
            bestOwnScore = ownScore;
            bestTieScore = tieScore;
        }
    }

    if (bestVector === null) {
        bestVector = evaluateAllPlayersFast(board, playerCounts, activePlayers);
    }

    ctx.tt.set(stateKey, bestVector);
    return bestVector;
}

function searchRootAtDepth(gameInstance, depth, config, deadline) {
    const board = gameInstance.board;
    const player = gameInstance.currentPlayer;
    const playerCounts = gameInstance.playerPiecesCount;
    const turnIndex = gameInstance.turnIndex;
    const activePlayers = gameInstance.activePlayers;

    const rootMoves = orderMovesForSearch(
        board,
        getAllPossibleMovesForPlayer(board, player),
        playerCounts
    );

    if (rootMoves.length === 0) {
        return { move: null, candidates: [], nodes: 0 };
    }

    const ctx = {
        config,
        deadline,
        tt: new Map(),
        nodes: 0,
        iterationDepth: depth
    };

    const playerIdx = PLAYER_INDEX[player];
    let bestMove = rootMoves[0];
    let bestScore = -Infinity;
    const candidates = [];

    // На первом уровне НЕ обрезаем варианты — ИИ сравнивает каждый
    // реально допустимый ход.
    for (const move of rootMoves) {
        checkAiDeadline(ctx);

        const result = applyMoveToBoard(board, move, playerCounts);
        const childActive = activePlayers.filter(p => (result.counts[p] || 0) > 0);

        let vector;
        if (isTerminalActivePlayers(childActive) || depth <= 1) {
            vector = evaluateAllPlayersFast(result.board, result.counts, childActive);
        } else {
            const next = getNextActivePlayer(turnIndex, childActive);
            vector = !next
                ? evaluateAllPlayersFast(result.board, result.counts, childActive)
                : maxN(result.board, result.counts, next.index, childActive, depth - 1, ctx);
        }

        const score = vector[playerIdx];
        candidates.push({ move, score });

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    candidates.sort((a, b) => b.score - a.score);
    return { move: bestMove, candidates, nodes: ctx.nodes };
}

// В командном режиме оценка обоих игроков одной команды одинакова.
// Поэтому AI+AI, AI+человек и сценарий 3 AI + 1 человек работают автоматически:
// AI цвета напарника помогает человеку, а два AI противоположных цветов играют вместе.
// ==================== ВЫБОР ХОДА ПО СЛОЖНОСТИ ====================
function chooseBestMove(gameInstance, level) {
    const legalMoves = getAllPossibleMovesForPlayer(
        gameInstance.board,
        gameInstance.currentPlayer
    );

    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    const config = AI_SEARCH_CONFIG[level] || AI_SEARCH_CONFIG.easy;
    const startTime = aiNow();
    const deadline = startTime + config.timeLimitMs;

    let bestMove = legalMoves[0];
    AI_WORK_DEADLINE = deadline;
    try { bestMove = orderMovesForSearch(gameInstance.board, legalMoves, gameInstance.playerPiecesCount)[0]; } catch(e) { if(e !== AI_TIMEOUT) {AI_WORK_DEADLINE=Infinity;throw e;} }
    let lastCompletedCandidates = [{ move: bestMove, score: -Infinity }];
    let completedDepth = 0;
    let totalNodes = 0;

    // Iterative deepening: если лимит времени закончится,
    // остаётся полностью рассчитанный результат предыдущей глубины.
    for (let depth = 1; depth <= config.maxDepth; depth++) {
        try {
            const result = searchRootAtDepth(gameInstance, depth, config, deadline);
            if (result.move) {
                bestMove = result.move;
                lastCompletedCandidates = result.candidates;
                completedDepth = depth;
                totalNodes += result.nodes;
            }

            if (aiNow() >= deadline) break;
        } catch (e) {
            if (e !== AI_TIMEOUT) { AI_WORK_DEADLINE=Infinity; throw e; }
            break;
        }
    }

    // Лёгкий ИИ иногда выбирает почти равный ход, средний — редко.
    // Сложный всегда берёт лучший полностью рассчитанный вариант.
    if (config.randomMargin > 0 && lastCompletedCandidates.length > 1) {
        const bestScore = lastCompletedCandidates[0].score;
        const nearBest = lastCompletedCandidates.filter(
            c => c.score >= bestScore - config.randomMargin
        );

        if (nearBest.length > 1) {
            bestMove = nearBest[Math.floor(Math.random() * nearBest.length)].move;
        }
    }

    AI_WORK_DEADLINE = Infinity;
    return bestMove;
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
    Piece, STARTING_POSITIONS, TURN_ORDER, TEAM_MAP, colLabels, rowLabels,
    emptyCaptureStats, getAllPossibleMovesForPlayer, applyMoveToBoard, chooseBestMove,
    setMode(mode) { CURRENT_GAME_MODE=mode; },
    resetDeadline() { AI_WORK_DEADLINE=Infinity; }
};
