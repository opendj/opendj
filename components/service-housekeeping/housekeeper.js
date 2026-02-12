'use strict';

const readline = require('readline');
const fs = require('fs');
const log4js = require('log4js')
const log = log4js.getLogger();
const cron = require('node-cron');

// ----------------------------------------------------------------------------------
// ------------------------------ ENVIRONMENT VARIABLES -----------------------------
// ----------------------------------------------------------------------------------

log.level = process.env.LOG_LEVEL || "trace";
const ENV_DATAGRID_URL = process.env.DATAGRID_URL || "localhost:11222"
const ENV_DATAGRID_USER = process.env.DATAGRID_USER || "developer"
const ENV_DATAGRID_PSWD = process.env.DATAGRID_PSWD || "--secret--"
const ENV_EVENT_STORAGE = process.env.EVENT_STORAGE || "./events/"
const ENV_CRONTAB = process.env.CRONTAB

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ------------------------------ datagrid stuff -----------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
const datagrid = require('infinispan');
var gridEvents = null;
var gridEventExt = null;
var gridPlaylists = null;
var gridProviderSpotify = null;

async function connectToGrid(name) {
    let cache = null;
    try {
        log.trace("begin connectToGrid %s", name);
        let splitter = ENV_DATAGRID_URL.split(":");
        let host = splitter[0];
        let port = splitter[1];
        cache = await datagrid.client([{ host: host, port: port }], {
          cacheName: name,
          authentication: {
            enabled: true,
            saslMechanism: 'DIGEST-MD5',
            userName: ENV_DATAGRID_USER,
            password: ENV_DATAGRID_PSWD,
            serverName: 'infinispan'},
          dataFormat : {
            keyType: 'text/plain',
            valueType: 'text/plain'
            }});
        log.trace("end connected to grid %s", name);
    } catch (err) {
        throw "DataGrid connection FAILED with err " + err;
    }

    return cache;
}

async function getFromGrid(cache, key) {
    try {
        let val = await cache.get(key);
        if (val)
            val = JSON.parse(val);
        return val;
    } catch (err) {
        handleCacheError(cache, err);
        throw err;
    }
}


function handleCacheError(cache, err) {
    log.error("Cache error: %s", err);
    log.error("cache=%s", JSON.stringify(cache));
    readyState.datagridClient = false;
    readyState.lastError = err;
    //TODO: Try to reconnect
}

async function getPlaylistWithID(eventID, playlistID) {
    log.trace("begin getPlaylistWithID %s:%s", eventID, playlistID);
    let playlist = await getFromGrid(gridPlaylists, eventID + ":" + playlistID);
    log.trace("end getPlaylistWithID");
    return playlist;
}

async function getEventExtForEventID(eventID) {
    log.trace("begin getEventExtForEventID id=%s", eventID);
    let eventExt = await getFromGrid(gridEventExt, eventID);
    log.trace("end getEventForEventID id=%s", eventID);

    return eventExt;
}


function exportEvent(event) {
    log.trace("begin exportEvent", event.eventID);
    let fname = ENV_EVENT_STORAGE +
        (ENV_EVENT_STORAGE.endsWith('/') ? '' : '/') +
        event.eventStartsAt.substring(0, 16).replace(':', '-') +
        'Z_' + event.eventID;

    log.debug("exportEvent fname=", fname);
    fs.writeFileSync(fname, JSON.stringify(event, null, 2));

    log.trace("end exportEvent", event.eventID);
}

async function retrievePlaylists(event) {
    let playlists = [];
    // retrieve playlists:
    for (let playlistID of event.playlists) {
        log.trace("get playlist id=", playlistID);
        let playlist = await getPlaylistWithID(event.eventID, playlistID);
        if (playlist) {
            playlists.push(playlist);
            //log.trace("playlist=", JSON.stringify(playlist));
        }
    }
    // Replace Array of IDs with actuals playlists:
    event.playlists = playlists;
}

async function deleteEvent(event) {
    log.trace("begin deleteEvent");
    let del = null;
    for (let playlist of event.playlists) {
        del = await gridPlaylists.remove(event.eventID + ':' + playlist.playlistID);
        log.trace("playlist with id=%s was deleted = %s", playlist.playlistID, del);
    }
    del = await gridEventExt.remove(event.eventID);
    log.trace("eventExt was deleted = %s", del);

    del = await gridEvents.remove(event.eventID);
    log.trace("event was deleted = %s", del);

    del = await gridProviderSpotify.remove(event.eventID);
    log.trace("provider spotify was deleted = ", del);

    log.info("EVENT DELETED id=", event.eventID);

    log.trace("end deleteEvent");
}


async function checkEvent(event) {
    log.trace("begin checkEvent");
    try {
        log.debug("checkEvent for id %s", event.eventID);
        if (log.isTraceEnabled) {
            log.trace("event = ", JSON.stringify(event));
        }

        await retrievePlaylists(event);
        event.ext = await getEventExtForEventID(event.eventID);
        await exportEvent(event);
        if (Date.now() > Date.parse(event.eventEndsAt)) {
            await deleteEvent(event);
        }
    } catch (err) {
        log.error("checkEvent %s failed with err %s - ignored", event.eventID, err);
    }
    log.trace("end checkEvent");
}


async function checkEvents() {
    log.trace("checkEvents begin");
    try {
        let it = await gridEvents.iterator(10);
        let entry = await it.next();

        while (!entry.done) {
            log.trace("checkEvents grid iterator key=%s", entry.key);
            if ("-1" == entry.key) {
                log.trace("ignoring key -1 used for clever event checking");
            } else {
                let event = JSON.parse(entry.value);
                if (event.playlists) {
                    await checkEvent(event);
                } else {
                    log.debug("ignoring strange event from grid with key %s", entry.key);
                    //                if (log.isTraceEnabled()) log.trace("entry=%s", JSON.stringify(entry));
                }
            }

            log.trace("Get next entry from cache iterator");
            entry = await it.next();
        }

        await it.close();

    } catch (err) {
        log.error("checkEvents failed with err %s", err);
    }

    log.trace("checkEvents end");
}


async function main() {
    try {
        log.info("BEGIN HOUSEKEEPING");
        gridEvents = await connectToGrid("EVENTS");
        gridEventExt = await connectToGrid("EVENT_EXT");
        gridPlaylists = await connectToGrid("PLAYLISTS");
        gridProviderSpotify = await connectToGrid("PROVIDER_SPOTIFY_STATE");


        await checkEvents();

        log.debug("Disconnecting from datagrid...");
        gridEvents.disconnect();
        gridEventExt.disconnect();
        gridPlaylists.disconnect();
        gridProviderSpotify.disconnect();

        log.debug("END HOUSEKEEPING");
    } catch (err) {
        log.fatal("!!!!!!!!!!!!!!!");
        log.fatal("main failed with err %s", err);
        log.fatal("Terminating now");
        log.fatal("!!!!!!!!!!!!!!!");
        process.exit(42);
    }
}

if (ENV_CRONTAB) {
    log.info("Using crontab %s", ENV_CRONTAB);
    cron.schedule(ENV_CRONTAB, main);
} else {
    log.info("No crontab - executing once");
    setImmediate(main);
}
