const _ = require('underscore');
const compression = require('compression');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const router = new express.Router();
const cors = require('cors');
const io = require('socket.io')(http, { origins: '*:*', path: '/api/service-web/socket' });
const { Kafka, logLevel } = require('kafkajs');
const { v1: uuidv1 } = require('uuid');

const eventActivityClient = require('./EventActivityClient');
const port = process.env.PORT || 3000;
const ENV_THROTTLE_EMITTER_PLAYLIST = parseInt(process.env.THROTTLE_EMITTER_PLAYLIST || '1000');
const ENV_EMIT_ACTIVITY = (process.env.EMIT_ACTIVITY || 'true') == 'true';

const ENV_KAFKA_HOST = process.env.KAFKA_HOST || "localhost:9092";
const ENV_KAFKA_TOPIC_ACTIVITY = process.env.topic || "opendj.event.activity";
const ENV_KAFKA_IGNORE_MISSING = (process.env.KAFKA_IGNORE_MISSING || 'false') == 'true';
const ENV_KAFKA_TOPIC_NUM_PARTITIONS = process.env.KAFKA_TOPIC_NUM_PARTITIONS || 1;
const ENV_KAFKA_TOPIC_REPLICATION_FACTOR = process.env.TOPIC_REPLICATION_FACTOR || 1;


const log4js = require('log4js')
const log = log4js.getLogger();
log.level = process.env.LOG_LEVEL || "trace";
app.use(cors());
app.use(compression())
app.use(express.json());
app.use("/api/service-web/v1", router);

var readyState = {
    datagridClient: false,
    kafkaClient: false,
    websocket: false,
    lastError: ""
};

var EVENT_INFO_PROTOTYPE = {
    activityHistory: [],
    userSet: {},
    curatorSet: {},

    numUsers: 0,
    numUsersOnline: 0,
    maxUsers: 0,
    maxUsersOnline: 0,
    numCurators: 0,
    numCuratorsOnline: 0,
    numTracksPlayed: 0,
}

var mapOfEventStats = new Map();

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ------------------------------- logic stuff -------------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

function updateEventStatsFromActivity(activity) {
    log.trace("begin updateEventStatsFromActivity");

    let stats = mapOfEventStats.get(activity.eventID);
    let updated = false;
    let result = null;
    let userState = null;
    let username = null;

    if (!stats) {
        stats = JSON.parse(JSON.stringify(EVENT_INFO_PROTOTYPE));
        stats.userSet = new Set();
        stats.curatorSet = new Set();
        stats.activityHistory = new Array();
        mapOfEventStats.set(activity.eventID, stats);
    }

    stats.activityHistory.push(activity);
    if (stats.activityHistory.length > 20) {
        stats.activityHistory.shift();
    }

    switch (activity.activity) {
        case 'USER_LOGIN':
            userState = activity.data.fromClient.userState;
            username = userState.username;
            stats.userSet.add(username);
            stats.numUsers = stats.userSet.size;
            if (userState.isCurator) {
                stats.curatorSet.add(username);
                stats.numCurators = stats.curatorSet.size;
            }
            if (stats.numUsers > stats.maxUsers) {
                stats.maxUsers = stats.numUsers;
            }
            updated = true;
            break;

        case 'USER_LOGOUT':
            userState = activity.data.userState;
            username = userState.username;
            stats.userSet.delete(username);
            stats.numUsers = stats.userSet.size;
            if (userState.isCurator) {
                stats.curatorSet.delete(username);
                stats.numCurators = stats.curatorSet.size;
            }
            updated = true;
            break;

        case 'USER_CONNECT':
            username = activity.data.user;
            stats.numUsersOnline++;
            if (stats.curatorSet.has(username)) {
                stats.numCuratorsOnline++;
            }
            if (stats.numUsersOnline > stats.maxUsersOnline) {
                stats.maxUsersOnline = stats.numUsersOnline;
            }
            updated = true;
            break;

        case 'USER_DISCONNECT':
            username = activity.data.user;
            stats.numUsersOnline--;
            if (stats.curatorSet.has(username)) {
                stats.numCuratorsOnline--;
            }
            updated = true;
            break;

        case 'TRACK_PLAY':
            stats.numTracksPlayed++;
            updated = true;
            break;

        case 'EVENT_CREATE':
            break;

        case 'EVENT_DELETE':
            break;
    }

    if (updated) {
        result = stats;
    }
    log.trace("end updateEventStatsFromActivity");
    return result;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ------------------------------- kafka stuff -------------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

async function kafkaCreateTopic(kafka, topicName) {
    log.trace("kafkaCreateTopic begin");

    const admin = kafka.admin();

    try {
        await admin.connect();
        log.debug("kafkaCreateTopic topicName=%s", topicName);

        await admin.createTopics({
            topics: [{
                topic: topicName,
                numPartitions: parseInt(ENV_KAFKA_TOPIC_NUM_PARTITIONS),
                replicationFactor: parseInt(ENV_KAFKA_TOPIC_REPLICATION_FACTOR)
            }]
        });

        log.info("Successfully created topic: %s", topicName);
    } catch (err) {
        log.error("kafka create topic failed", err);
    } finally {
        await admin.disconnect();
    }

    log.trace("kafkaCreateTopic end");
}

// Initialize KafkaJS client
const kafka = new Kafka({
    clientId: 'opendj-service-web',
    brokers: ENV_KAFKA_HOST.split(','),
    connectionTimeout: 1000,
    requestTimeout: 500,
    retry: {
        retries: 10,
        factor: 1,
        minTimeout: 5000,
        maxTimeout: 2000,
        randomize: true,
    },
    logLevel: logLevel.ERROR,
});

// Initialize connection state (KafkaJS handles connection internally)
log.info("KafkaJS client initialized with brokers: %s", ENV_KAFKA_HOST);
readyState.kafkaClient = true;
readyState.lastError = '';

// Consumer state tracking
let consumerInstance = null;
let isReconnecting = false;
let reconnectAttempts = 0;
let isShuttingDown = false; // Flag to prevent reconnection during shutdown
const MAX_RECONNECT_ATTEMPTS = 100; // Effectively unlimited with exponential backoff
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 60000; // 60 seconds

// Calculate exponential backoff delay
function getReconnectDelay(attempt) {
    const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
    const jitter = Math.random() * 1000; // Add up to 1 second jitter
    return delay + jitter;
}

// Reconnection function with exponential backoff
async function reconnectConsumer() {
    if (isShuttingDown) {
        log.info("Application is shutting down, skipping reconnection");
        return;
    }

    if (isReconnecting) {
        log.debug("Reconnection already in progress, skipping");
        return;
    }

    isReconnecting = true;
    reconnectAttempts++;

    const delay = getReconnectDelay(reconnectAttempts);
    log.info("Attempting to reconnect Kafka consumer (attempt %d) after %dms", reconnectAttempts, delay);

    setTimeout(async () => {
        try {
            await startKafkaConsumer();
            reconnectAttempts = 0; // Reset on successful connection
            isReconnecting = false;
            log.info("Kafka consumer reconnected successfully");
        } catch (error) {
            log.error("Reconnection attempt %d failed: %s", reconnectAttempts, error);
            isReconnecting = false;

            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectConsumer();
            } else {
                log.fatal("Max reconnection attempts reached. Manual intervention required.");
                readyState.kafkaClient = false;
                readyState.lastError = "Max reconnection attempts exceeded";
            }
        }
    }, delay);
}

async function startKafkaConsumer() {
    // Disconnect old consumer if exists
    if (consumerInstance) {
        try {
            log.debug("Disconnecting old consumer instance");
            await consumerInstance.disconnect();
        } catch (err) {
            log.warn("Error disconnecting old consumer (ignored): %s", err);
        }
    }

    // Create consumer with random group ID (all pods consume independently)
    const consumer = kafka.consumer({
        groupId: `opendj-service-web-${uuidv1()}`,
        retry: {
            retries: 2,
        }
    });

    // Store consumer instance for reconnection
    consumerInstance = consumer;

    // Add event handlers for connection issues
    consumer.on(consumer.events.DISCONNECT, () => {
        if (!isShuttingDown) {
            log.warn("Kafka consumer DISCONNECTED - attempting reconnection");
            readyState.kafkaClient = false;
            readyState.lastError = "Consumer disconnected";
            reconnectConsumer();
        } else {
            log.info("Kafka consumer DISCONNECTED during shutdown (expected)");
        }
    });

    consumer.on(consumer.events.CRASH, ({ error, groupId }) => {
        if (!isShuttingDown) {
            log.error("Kafka consumer CRASHED for groupId %s: %s", groupId, error);
            readyState.kafkaClient = false;
            readyState.lastError = `Consumer crashed: ${error}`;
            reconnectConsumer();
        } else {
            log.info("Kafka consumer CRASHED during shutdown (ignored)");
        }
    });

    consumer.on(consumer.events.CONNECT, () => {
        log.info("Kafka consumer CONNECTED successfully");
        readyState.kafkaClient = true;
        readyState.lastError = '';
        reconnectAttempts = 0; // Reset reconnect counter on successful connection
    });

    try {
        // Connect the consumer
        await consumer.connect();
        log.info("Kafka consumer connected");

        // Subscribe to topic
        await consumer.subscribe({
            topic: ENV_KAFKA_TOPIC_ACTIVITY,
            fromBeginning: false  // Fix #72: Do not start at the beginning
        });

        log.info("Kafka consumer subscribed to topic: %s", ENV_KAFKA_TOPIC_ACTIVITY);

        // Run the consumer
        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                log.trace("begin kafkaConsumer.onMessage");

                try {
                    const activity = JSON.parse(message.value.toString());
                    const eventID = activity.eventID;
                    const stats = updateEventStatsFromActivity(activity);

                    // Broadcast last 10 Messages:
                    // In KafkaJS, we need to fetch highWaterOffset separately if needed
                    // For now, we'll broadcast all messages (simplified logic)
                    log.trace("Message received - payload = %s", message.value.toString());
                    const namespace = getNameSpaceForEventID(eventID);
                    emitEventActivity(namespace, activity, stats);

                } catch (e) {
                    log.error("kafkaConsumer Exception while processing message - ignored", e);
                }
                log.trace("end kafkaConsumer.onMessage");
            },
        });

    } catch (error) {
        log.error("Kafka consumer error: %s", error);
        readyState.kafkaClient = false;
        readyState.lastError = error.message || error;

        // Check for topic not exist error
        if (error && error.message && (error.message.includes('topic') || error.type === 'UNKNOWN_TOPIC_OR_PARTITION')) {
            log.warn("Creating consumer failed with topic not exist error - trying to create the topic %s", ENV_KAFKA_TOPIC_ACTIVITY);
            try {
                await kafkaCreateTopic(kafka, ENV_KAFKA_TOPIC_ACTIVITY);
                log.info("Topic created, reconnecting consumer...");
            } catch (topicError) {
                log.error("Failed to create topic: %s", topicError);
            }
            // Use reconnection logic with exponential backoff
            reconnectConsumer();
        } else if (!ENV_KAFKA_IGNORE_MISSING) {
            // Retry on other errors using reconnection logic
            log.info("Consumer failed to start, using reconnection logic...");
            reconnectConsumer();
        } else {
            log.warn("Kafka consumer failed and KAFKA_IGNORE_MISSING is true - not reconnecting");
        }
    }

    // Handle graceful shutdown - prevent reconnection during shutdown
    const errorTypes = ['unhandledRejection', 'uncaughtException'];
    const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

    errorTypes.forEach(type => {
        process.on(type, async (e) => {
            try {
                log.error(`process.on ${type}`, e);
                isShuttingDown = true; // Prevent reconnection
                if (consumerInstance) {
                    await consumerInstance.disconnect();
                }
                process.exit(0);
            } catch (_) {
                process.exit(1);
            }
        });
    });

    signalTraps.forEach(type => {
        process.once(type, async () => {
            try {
                log.info(`Received ${type} signal, shutting down gracefully`);
                isShuttingDown = true; // Prevent reconnection
                if (consumerInstance) {
                    await consumerInstance.disconnect();
                }
            } finally {
                process.kill(process.pid, type);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ------------------------------ datagrid stuff -----------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
const datagrid = require('infinispan');
const DATAGRID_URL = process.env.DATAGRID_URL || "localhost:11222"
const DATAGRID_USER = process.env.DATAGRID_USER || "developer"
const DATAGRID_PSWD = process.env.DATAGRID_PSWD || "--secret--"
var gridPlaylists = null;
var gridEvents = null;

async function connectToGrid(name) {
    let grid = null;
    try {
        log.debug("begin connectToGrid %s", name);
        let splitter = DATAGRID_URL.split(":");
        let host = splitter[0];
        let port = splitter[1];
        grid = await datagrid.client([{ host: host, port: port }], {
          cacheName: name,
          authentication: {
            enabled: true,
            saslMechanism: 'DIGEST-MD5',
            userName: DATAGRID_USER,
            password: DATAGRID_PSWD,
            serverName: 'infinispan'},
          dataFormat : {
            keyType: 'application/json',
            valueType: 'application/json'
            }});
        readyState.datagridClient = true;
        log.debug("connectToGrid grid=%s client=%s", name, grid);
        log.info("connected to grid %s", name);
    } catch (err) {
        readyState.datagridClient = false;
        readyState.lastError = err;
        throw "DataGrid connection FAILED with err " + err;
    }

    return grid;
}

async function getFromGrid(grid, key) {
    try {
        let val = await grid.get(key);
        if (val)
            val = JSON.parse(val);
        return val;
    } catch (err) {
        handleGridError(grid, err);
        throw err;
    }
}

function handleGridError(grid, err) {
    log.fatal("!!! Grid error", err);
    readyState.datagridClient = false;
    readyState.lastError = err;
    process.exit(44);
}

async function addCUDListenerForGrid(grid, listener) {
    log.trace("begin addCUDListenerForGrid grid=%s", grid);
    let listenerID = await grid.addListener('create', listener);
    await grid.addListener('modify', listener, { listenerId: listenerID });
    await grid.addListener('remove', listener, { listenerId: listenerID });
    await grid.addListener('expiry', listener, { listenerId: listenerID });
}

async function connectToDatagrid() {
    log.info("Connecting to datagrid...");
    gridEvents = await connectToGrid("EVENTS");
    gridPlaylists = await connectToGrid("PLAYLISTS");


    log.debug("Register listeners...");
    await addCUDListenerForGrid(gridEvents, onEventModified);
    await addCUDListenerForGrid(gridPlaylists, onPlaylistModifiedWithThrottle);

    log.debug("Connecting to datagrid...DONE");
    readyState.datagridClient = true;
}

async function checkGridConnection() {
    log.trace("begin checkGridConnection");
    let result = false;
    for (let i = 0; i < 3; i++) {

        try {
            await gridEvents.get("-1");
            readyState.datagridClient = true;
            readyState.lastError = "";
            result = true;
        } catch (err) {
            readyState.datagridClient = false;
            readyState.lastError = err;
            log.error("checkGridConnection failed - try to reconnect", err);
            try {
                await connectToDatagrid();
            } catch (reconnectError) {
                log.debug("checkGridConnection: re-connect error ignored", reconnectError);
            }
        }
    }

    log.trace("end checkGridConnection result=", result);
    return result;
}

const mapOfPlaylistThrottles = new Map();

async function onPlaylistModifiedWithThrottle(key, entryVersion, listenerID) {
    log.trace("begin onPlaylistModifiedWithThrottle key=%s", key);
    let throttledOnPlaylistModified = mapOfPlaylistThrottles.get(key);
    if (!throttledOnPlaylistModified) {
        log.debug("create throttle for onPlaylistModified for event=%s", key)
        throttledOnPlaylistModified = _.throttle(onPlaylistModified, ENV_THROTTLE_EMITTER_PLAYLIST);
        mapOfPlaylistThrottles.set(key, throttledOnPlaylistModified);
    }
    throttledOnPlaylistModified(key, entryVersion, listenerID);
    log.trace("end onPlaylistModifiedWithThrottle key=%s", key);
}


async function onPlaylistModified(key, entryVersion, listenerID) {
    log.trace("begin onPlaylistModified key=%s", key);
    try {
        if (key.indexOf(':') < 0) {
            log.debug("onPlaylistModified: ignore strange event with key %s", key);
            return;
        }

        let splitter = key.split(":");
        let eventID = splitter[0];
        let playlistID = splitter[1];

        let playlist = await getPlaylistForPlaylistID(key);
        let namespace = getNameSpaceForEventID(eventID);
        emitPlaylist(namespace, playlist);
    } catch (err) {
        log.error("onPlaylistModified  failed - ignoring err=%s", err);
    }

    log.trace("end onPlaylistModified key=%s", key);
}

async function onEventModified(key, entryVersion, listenerID) {
    log.trace("begin onEventModified key=%s", key);
    try {
        if (key.indexOf(':') > 0) {
            log.trace("onEventModified: ignore strange event with key %s", key);
        } else if ("-1" == key) {
            log.trace("ignoring event key used for clever event checking");
        } else {
            log.trace("get and emit eventID=%s", key);
            let eventID = key;
            let event = await getEventForEventID(key);
            let namespace = getNameSpaceForEventID(eventID);
            emitEvent(namespace, event);
        }
    } catch (err) {
        log.error("onEventModified failed - ignoring err=%s", err);
    }

    log.trace("end onEventModified key=%s", key);
}


async function getEventForEventID(eventID) {
    log.trace("begin getEventForEventID id=%s", eventID);
    let event = await getFromGrid(gridEvents, eventID);
    if (event == null) {
        log.warn("getEventForEventID event is null for id=%s", eventID);
    } else {
        if (log.isTraceEnabled())
            log.trace("event from grid = %s", JSON.stringify(event));
    }
    log.trace("end getEventForEventID id=%s", eventID);
    return event;
}
async function getPlaylistForPlaylistID(playlistID) {
    log.trace("begin getPlaylistForPlaylistID id=%s", playlistID);
    let playlist = await getFromGrid(gridPlaylists, playlistID);
    if (playlist == null) {
        log.warn("getPlaylistForPlaylistID event is null for id=%s", playlistID);
    } else {
        if (log.isTraceEnabled())
            log.trace("playlist from grid = %s", JSON.stringify(playlist));
    }
    log.trace("end getPlaylistForPlaylistID id=%s", playlistID);
    return playlist;
}


// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// ------------------------------ websocket stuff -----------------------------
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
function getEventIDFromSocketNamespace(socket) {
    const nsp = socket.nsp;
    let eventID = null;
    if (nsp && nsp.name && nsp.name.startsWith("/event/"))
        eventID = nsp.name.slice("/event/".length);
    log.trace("getEventIDFromSocketNamespace eventID=%s", eventID);
    return eventID;
}

function getNameSpaceForEventID(eventID) {
    return io.of("/event/" + eventID);
}



function emitPlaylist(socketOrNamespace, playlist) {
    log.trace("begin emitPlaylist id=%s", playlist.playlistID);

    log.trace("nsp=%s", socketOrNamespace.nsp);

    socketOrNamespace.emit('current-playlist', playlist);
    log.trace("end emitPlaylist id=%s", playlist.playlistID);
}

function emitEvent(socketOrNamespace, event) {
    log.trace("begin emitEvent");
    if (event) {
        log.debug("emitEvent current-event for ID=%s", event.eventID);
    } else {
        log.debug("emitEvent current-event with null - aka delete-event");
    }
    // Remove effective Playlist to save bandwidth:
    event.effectivePlaylist = [];

    socketOrNamespace.emit("current-event", event);
    log.trace("end emitEvent");
}

function emitEventActivity(socket, activity, stats) {
    log.trace("begin emitEventActivity");
    if (ENV_EMIT_ACTIVITY) {
        // We broadcast only a striped down version to save bandwidth:
        let simpleActivity = {
            activity: activity.activity,
            display: activity.display,
            timestamp: activity.timestamp
        };
        if (stats) {
            let statsClone = Object.assign({}, stats);
            delete statsClone.activityHistory;
            delete statsClone.userSet;
            delete statsClone.curatorSet;
            simpleActivity.stats = statsClone;
        }

        socket.emit("event-activity", simpleActivity);
        log.debug("event activity emitted successfully: ", simpleActivity);
    } else {
        log.debug("event activity emitter is disabled");
    }

    log.trace("end emitEventActivity");
}



async function emitEventToSocket(socket) {
    log.trace("begin emitEventToSocket");
    let eventID = getEventIDFromSocketNamespace(socket);
    let currentEvent = await getEventForEventID(eventID);
    log.debug("emit current-event %s to socket %s", eventID, socket.id);
    emitEvent(socket, currentEvent);
    log.trace("end emitEventToSocket");
}

async function onRefreshEvent(socket) {
    log.trace("begin onRefreshEvent socket.id=%s", socket.id);
    try {
        await emitEventToSocket(socket);
    } catch (err) {
        log.error("onRefreshEvent failed - ignoring err %s", err);
    }
    log.trace("end onRefreshEvent socket.id=%s", socket.id);
}

async function onRefreshPlaylist(socket) {
    log.trace("begin onRefreshPlaylist socket.id=%s", socket.id);
    try {
        let eventID = getEventIDFromSocketNamespace(socket);
        let event = await getEventForEventID(eventID);
        if (event) {
            let playlist = await getPlaylistForPlaylistID(eventID + ":" + event.activePlaylist);
            emitPlaylist(socket, playlist);
        } else {
            log.debug("ignoring refresh request for non-existing playlist - probably it has been deleted");
        }
    } catch (err) {
        log.error("onRefreshPlaylist failed - ignoring err %s", err);
    }
    log.trace("end onRefreshPlaylist socket.id=%s", socket.id);
}

function onDisconnect(socket) {
    const eventID = getEventIDFromSocketNamespace(socket);
    const user = socket.handshake.query.user;
    if (eventID) {
        log.debug('user %s disconnected to event %s with socket %s', user, eventID, socket.id);
        eventActivityClient.publishActivity(
            'USER_DISCONNECT', eventID, { user: user }, '' + user + ' disconnected');
    }
}


async function onWebsocketConnection(socket) {
    log.trace("begin onWebsocketConnection socket.id=%s", socket.id);

    const eventID = getEventIDFromSocketNamespace(socket);
    const user = socket.handshake.query.user;

    if (eventID) {
        log.debug('user %s connected to event %s with socket %s', user, eventID, socket.id);

        log.debug("Register callbacks");
        socket.on('refresh-event', function() {
            onRefreshEvent(socket);
        });
        socket.on('refresh-playlist', function() {
            onRefreshPlaylist(socket);
        });

        socket.on('disconnect', function() {
            onDisconnect(socket);
        });

        try {
            // Send Welcome Package:
            let event = await getEventForEventID(eventID);
            if (event) {
                emitEvent(socket, event);
                let playlist = await getPlaylistForPlaylistID(eventID + ":" + event.activePlaylist);
                if (playlist) {
                    emitPlaylist(socket, playlist);
                } else {
                    log.warn("onWebsocketConnection: no active playlist with ID %s for event %s in grid", event.activePlaylist, eventID);
                }

                eventActivityClient.publishActivity(
                    'USER_CONNECT', eventID, { user: user }, '' + user + ' connected');

            } else {
                log.warn("onWebsocketConnection: no event with ID %s in grid", eventID);
            }
        } catch (err) {
            log.error("onWebsocketConnection sent welcome package failed - ignoring err %s", err);
        }

    } else {
        log.warn("Socket connect without namespace - disconnecting");
        socket.disconnect(true);
    }

    log.trace("end onWebsocketConnection socket.id=%s", socket.id);
}

// Register Dynamic namespaces with IO:
log.trace("Register websocket namespace");

io.of(/^\/event\/.+$/)
    .on('connect', onWebsocketConnection);

// -----------------------------------------------------------------------
// -----------------------------------------------------------------------
// ------------------------------ Web routes -----------------------------
// -----------------------------------------------------------------------
// -----------------------------------------------------------------------

// ------
// Login:
router.post('/events/:eventID/user/login', async function(req, res) {
    log.trace("begin login eventId=%s", req.params.eventID);
    log.trace("body=%s", JSON.stringify(req.body));
    log.trace("headers=%s", JSON.stringify(req.headers));

    try {
        let eventID = req.params.eventID;
        let userState = req.body.userState;
        let data = {
            fromClient: req.body,
            requestHeaders: req.headers,
            connectionSrcIP: req.connection.remoteAddress
        }
        eventActivityClient.publishActivity(
            'USER_LOGIN', eventID, data, 'Welcome ' + userState.username);
        res.status(200).send();
    } catch (error) {
        log.debug(error);
        res.status(406).send(JSON.stringify(error));
    }
});

// ------
// Logout:
router.post('/events/:eventID/user/logout', async function(req, res) {
    log.trace("begin logout eventId=%s", req.params.eventID);
    log.trace("body=%s", JSON.stringify(req.body));

    try {
        let eventID = req.params.eventID;
        let userState = req.body.userState;
        eventActivityClient.publishActivity(
            'USER_LOGOUT', eventID, { userState: userState }, 'Goodbye ' + userState.username);
        res.status(200).send();
    } catch (error) {
        log.debug(error);
        res.status(406).send(JSON.stringify(error));
    }
});


// -----------------------
// Ready and Health Check:
async function readyAndHealthCheck(req, res) {
    log.trace("begin readyAndHealthCheck");
    // Default: not ready:
    let status = 500;
    let gridOkay = await checkGridConnection();
    if (readyState.datagridClient &&
        readyState.websocket &&
        gridOkay) {
        status = 200;
    }

    res.status(status).send(JSON.stringify(readyState));
    log.trace("end readyAndHealthCheck status=", status);
}

router.get('/ready', readyAndHealthCheck);
router.get('/health', readyAndHealthCheck);


// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// ------------------------------ init stuff -----------------------------
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
setImmediate(async function() {
    try {
        await connectToDatagrid();
        startKafkaConsumer();

        http.listen(port, function() {
            log.info('listening on *: ' + port);
            readyState.websocket = true;
        });

    } catch (err) {
        log.fatal("!!!!!!!!!!!!!!!");
        log.fatal("init failed with err %s", err);
        log.fatal("Terminating now");
        log.fatal("!!!!!!!!!!!!!!!");
        process.exit(42);
    }
});
