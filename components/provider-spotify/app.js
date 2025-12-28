'use strict';

const readline = require('readline');
const fs = require('fs');
const compression = require('compression');
const express = require('express');
const app = express();
const router = new express.Router();
const cors = require('cors');
const request = require('request-promise');
const promiseRetry = require('promise-retry');
const log4js = require('log4js')
const log = log4js.getLogger();
log.level = process.env.LOG_LEVEL || "trace";

const PORT = process.env.PORT || 8081;
const COMPRESS_RESULT = process.env.COMPRESS_RESULT || "true";
const readyState = {
    datagridClient: false,
    refreshExpiredTokens: false,
    lastError: ""
};

const PLAYLIST_PROVIDER_URL = process.env.PLAYLIST_PROVIDER_URL || "http://localhost:8082/api/service-playlist/v1/";

//

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ------------------------------ datagrid stuff -----------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
const DATAGRID_URL = process.env.DATAGRID_URL || "localhost:11222"
const DATAGRID_USER = process.env.DATAGRID_USER || "developer"
const DATAGRID_PSWD = process.env.DATAGRID_PSWD || "--secret--"
const datagrid = require('infinispan');
var cacheTracks = null;
var cacheState = null;

const CACHE_CONFIG_XML = `<infinispan>
    <cache-container>
        <distributed-cache mode="SYNC" name="dummy" owners="2">
            <memory storage="HEAP"  max-count="10000" when-full="REMOVE"/>
            <expiration lifespan="-1" max-idle="-1" interval="0" />
            <partition-handling when-split="ALLOW_READS"/>
            <persistence>
                <file-store shared="false" preload="true">
                    <write-behind modification-queue-size="200" fail-silently="false"/>
                </file-store>
            </persistence>
            <encoding media-type="application/json"/>
        </distributed-cache>
    </cache-container>
</infinispan>`



async function createCache(name) {
  try {
    log.trace("try to create Cache");

    let result = await request({
        method: 'POST',
        uri: 'http://' + DATAGRID_URL + '/rest/v2/caches/' + name,
        body: CACHE_CONFIG_XML,
        headers: {
            "Content-Type": "application/xml"
        },
        auth: {
            user: DATAGRID_USER,
            password: DATAGRID_PSWD,
            sendImmediately: false
        },

        timeout: 10000
    });
    log.info("CREATED cache %s", name);
  } catch (createErr){
    if (createErr.error && createErr.error.includes("ISPN000507")) {
      log.trace("cache already exists, error is ignored");
    } else {
      throw createErr;
    }
  }
}


async function connectToCache(name) {
    let cache = null;
    try {
        log.debug("begin connectToCache %s", name);
        let splitter = DATAGRID_URL.split(":");
        let host = splitter[0];
        let port = splitter[1];
        cache = await datagrid.client([{ host: host, port: port }], {
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
        log.debug("connected to grid %s", name);
    } catch (err) {
      if ((""+err).includes("CacheNotFoundException")) {
        await createCache(name);
        cache = connectToCache(name);
      } else {
        log.error("Shit hit the fan", err);
        readyState.datagridClient = false;
        readyState.lastError = err;
        throw "DataGrid connection FAILED with err " + err;
      }
    }

    return cache;
}

function disconnectFromCache(cache) {
    if (cache) {
        try {
            cache.disconnect();
        } catch (err) {
            log.debug("disconnectFromCache - err ignored", err);
        }
    }
}

async function checkGridConnection() {
    log.trace("begin checkGridConnection");
    let result = false;
    for (let i = 0; i < 3; i++) {

        try {
            await cacheTracks.get("-1");
            readyState.datagridClient = true;
            readyState.lastError = "";
            result = true;
        } catch (err) {
            readyState.datagridClient = false;
            readyState.lastError = err;
            log.error("checkGridConnection failed - try to reconnect", err);
            try {
                await connectAllCaches();
            } catch (reconnectError) {
                log.debug("checkGridConnection: re-connect error ignored", reconnectError);
            }
        }
    }

    log.trace("end checkGridConnection result=", result);
    return result;
}

async function connectAllCaches() {
    log.trace("begin connectAllCaches");
    disconnectFromCache(cacheTracks);
    disconnectFromCache(cacheState);
    cacheTracks = await connectToCache("TRACKS");
    cacheState = await connectToCache("PROVIDER_SPOTIFY_STATE");
    log.info("CACHES CONNECTED");
    log.trace("end connectAllCaches");
}

async function getFromCache(cache, key) {
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

async function putIntoCache(cache, key, value) {
    log.trace("begin putIntoCache");
    await cache.put(key, JSON.stringify(value));
    log.trace("end putIntoCache");
}

function putIntoCacheAsync(cache, key, value) {
    log.trace("begin putIntoCacheAsync cache=%s, key=%s, value=%s", cache, key, value);
    cache.put(key, JSON.stringify(value))
        .then(function() {
            log.trace("putIntoCacheAsync success");
        })
        .catch(function(err) {
            log.warn("putIntoCacheAsync failed - ignoring error %s", err);
            handleCacheError(cache, err);
        });
    log.trace("end putIntoCache");
}

function fireEventStateChange(event) {
    log.trace("begin fireEventStateChange");
    putIntoCacheAsync(cacheState, event.eventID, event);
    log.trace("end fireEventStateChange");
}

function handleCacheError(cache, err) {
    log.error("Cache error: %s", err);
    log.error("cache=%s", JSON.stringify(cache));
    readyState.datagridClient = false;
    readyState.lastError = err;
    handleFatalError();
}

// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// ------------------- spotify authentication stuff -------------------------
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
const SpotifyWebApi = require('spotify-web-api-node');
const spotifyClientID = process.env.SPOTIFY_CLIENT_ID || "-unknown-";
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET || "-unknown-";
const spotifyRedirectUri = process.env.SPOTIFY_CALLBACK_URL || "-unknown-";
const spotifyScopes = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-modify-private', 'user-read-email', 'playlist-read-private', 'playlist-read-collaborative'];

// Interval we check for expired tokens:
const SPOTIFY_REFRESH_TOKEN_INTERVAL = process.env.SPOTIFY_REFRESH_TOKEN_INTERVAL || "60000";


// Offset we refresh a token BEFORE it expires - to be sure, we do this 5 minutes BEFORE
// it expires:
const SPOTIFY_REFRESH_TOKEN_OFFSET = process.env.SPOTIFY_REFRESH_TOKEN_OFFSET || "300000";

// To avoid that several pods refresh at the same time, we add some random
// value (up to 3 min) to the offset:
const SPOTIFY_REFRESH_TOKEN_OFFSET_RANDOM = process.env.SPOTIFY_REFRESH_TOKEN_OFFSET_RANDOM || "180000";

// Number of genres to return for track details:
const SPOTIFY_TRACK_DETAIL_NUM_GENRES = process.env.SPOTIFY_TRACK_DETAIL_NUM_GENRES || "2";
const SPOTIFY_TRACK_DETAIL_NUM_ARTISTS = process.env.SPOTIFY_TRACK_DETAIL_NUM_ARTISTS || "2";

const SPOTIFY_SEARCH_LIMIT = process.env.SPOTIFY_SEARCH_LIMIT || "20";

const SPOTIFY_AUTOSELECT_DEVICE = (process.env.SPOTIFY_AUTOSELECT_DEVICE || 'true') == 'true';
const SPOTIFY_RETRIES = process.env.SPOTIFY_RETRIES || "1";;
const SPOTIFY_RETRY_TIMEOUT_MIN = process.env.SPOTIFY_RETRY_TIMEOUT_MIN || "1500";
const SPOTIFY_RETRY_TIMEOUT_MAX = process.env.SPOTIFY_RETRY_TIMEOUT_MAX || "2500";
const MAX_ACCOUNTS_PER_EVENT = process.env.MAX_ACCOUNTS_PER_EVENT || "20";
const MAX_PLAY_ERRORS = process.env.MAX_PLAY_ERRORS || "3";

// Map of Spotify API Objects:
// Key: EventID-AccountID
// Value: SpotifyWebApi Object
var mapOfSpotifyApis = {
    "42": null
}

// Example Object for an Event State - this is clone for all events:
const eventStatePrototype = {
    eventID: "-1", // ID of Music Event

    // map of accounts. key: accountID,value: account object
    accounts: {},
    timestamp: new Date().toISOString(),
};

const accountPrototype = {
    accountID: undefined,
    eventID: "-1", // ID of Music Event
    display: '',
    email: '',
    access_token: "",
    refresh_token: "",
    client_state: "",
    token_expires: "",
    token_created: "",
    token_refresh_failures: 0,
    play_failures: 0,
    isPlaying: false,
    currentTrack: "",
    currentDevice: "",
};

async function ensureNewEventVersionWithAccounts(event) {
    if ('accounts' in event) return;
    try {
        log.info('converting event with id %s to new structure', event.eventID);
        let account = Object.assign({}, event);
        let api = getSpotifyApiForAccount(account);
        let tokenData = await api.refreshAccessToken();
        updateTokensFromSpotifyBody(account, tokenData.body);

        let spotifyUser = await api.getMe();
        log.debug("spotifyUser", spotifyUser.body);
        event.accounts = {};
        updateAccountFromSpotifyUser(account, spotifyUser.body, event.owner);
        await addAccountToEvent(event, account, spotifyUser);
        fireEventStateChange(eventState);
    } catch (err) {
        log.error('converting event to new structure failed, removing it from cache');
        await cacheState.remove(event.eventID);
    }
}


function getTemporarySpotifyApi() {
    log.trace("begin getTemporarySpotifyApi clientId=>%s<, clientSecret=>%s<, redirectUri=>%s<", spotifyClientID, spotifyClientSecret, spotifyRedirectUri);
    return new SpotifyWebApi({
        clientId: spotifyClientID,
        clientSecret: spotifyClientSecret,
        redirectUri: spotifyRedirectUri
    });
}

function getAnyAccountForEvent(event) {
    log.trace("begin getAnyAccountForEvent");
    const accounts = Object.entries(event.accounts);
    if (accounts.length == 0) {
        throw {
            msg: "No Spotify accounts available! You have to add a spotify account using 'Edit Event' from the menu!",
            code: "SPTY-042"
        };
    }
    // For sake of simplicity, we simply take the first account.
    // TODO: select a random one for kind of load balancing between accounts
    // (not sure if this would make a difference)
    return accounts[0][1];
}

function getSpotifyApiForEvent(event) {
    log.trace("begin getSpotifyApiForEvent");
    return getSpotifyApiForAccount(getAnyAccountForEvent(event))
}

function getSpotifyApiForAccount(account) {
    let id = account.eventID + "-" + account.accountID;
    let spotifyApi = mapOfSpotifyApis[id];
    log.trace("begin getSpotifyApiForAccount", id);

    if (spotifyApi == null) {
        log.debug("Create SpotifyApi for id=%s...", id);
        spotifyApi = getTemporarySpotifyApi();
        if (account.accountID) {
            mapOfSpotifyApis[id] = spotifyApi;
        }
    } else {
        log.trace("spotifyApiForEvent %s already present", id);
    }
    // Make sure Api has latest Tokens:
    if (account.access_token != null && spotifyApi.getAccessToken() != account.access_token) {
        log.debug("Update API access token from state");
        spotifyApi.setAccessToken(account.access_token);
    }
    if (account.refresh_token != null && spotifyApi.getRefreshToken() != account.refresh_token) {
        log.debug("Update API refresh token from state");
        spotifyApi.setRefreshToken(account.refresh_token);
    }

    log.trace("end getSpotifyApiForAccount");
    return spotifyApi;
}

function getAccountForEvent(event, accountID) {
    log.trace("begin getAccountForEvent eventID=%s, accountID=%s", event.eventID, accountID);
    let account = event.accounts[accountID];
    if (account) {
        log.trace("using account from event", event);
    } else {
        log.debug("getAccountForEvent: creating account %s for event %s", accountID, event.eventID);
        account = JSON.parse(JSON.stringify(accountPrototype));
        account.accountID = accountID;
        account.eventID = event.eventID;
    }
    log.trace("end getAccountForEvent account=", account);
    return account;
}

async function getEvent(eventID) {
    log.trace("begin getEvent id=%s", eventID);
    let eventState = await getFromCache(cacheState, eventID);
    if (eventState == null) {
        log.debug("EvenState object created for eventID=%s", eventID);
        //        eventState = Object.assign({}, eventStatePrototype);
        eventState = JSON.parse(JSON.stringify(eventStatePrototype));
        eventState.eventID = eventID;
        eventState.timestamp = new Date().toISOString();
    } else {
        log.debug("getEvent - is in cache");
    }
    log.trace("end getEvent event=", eventState);
    return eventState;
}


function updateTokensFromSpotifyBody(account, body) {
    let now = new Date();
    log.trace("begin updateEventTokensFromSpotifyBody body=", body);
    if (body['access_token']) {
        log.trace("received new access token");
        account.access_token = body['access_token'];
    } else {
        log.error("THIS SHOULD NOT HAPPEN: received no new access token upon refresh, eventState=%s body=%s", JSON.stringify(eventState), JSON.stringify(body));
    }

    if (body['refresh_token']) {
        log.info("received new refresh token");
        account.refresh_token = body['refresh_token'];
    }

    account.token_created = now.toISOString();
    account.token_expires = new Date(now.getTime() + 1000 * body['expires_in']).toISOString();
    log.trace("end updateEventTokensFromSpotifyBody account=", account);
}

function updateAccountFromSpotifyUser(account, spotifyUser, openDJUser) {
    log.trace("begin updateAccountFromSpotifyUser");
    account.accountID = spotifyUser.id;
    account.email = spotifyUser.email;
    account.user = openDJUser;
    account.display = openDJUser + "/" + spotifyUser.display_name;
    log.trace("end updateAccountFromSpotifyUser account=", account);
}

function createProviderFromAccountAndUser(account, user) {
    let provider = {
        type: 'spotify',
        id: user.id,
        display: account.display,
        user: account.user,
        email: user.email,
    };
    if (user.images && user.images[0] && user.images[0].url) {
        provider.image_url = user.images[0].url;
    } else {
        provider.image_url = 'assets/img/user_unknown.png';
    }
    return provider;
}

async function addAccountToEvent(event, account, spotifyUser) {
    log.trace('begin addAccountToEvent');
    let trackStarted = false;

    log.debug("addAccountToEvent sanity checks");
    if (Object.values(event.accounts).length > MAX_ACCOUNTS_PER_EVENT) {
        throw {
            msg: "Sorry, max " + MAX_ACCOUNTS_PER_EVENT + "accounts per event allowed",
            code: "SPTY-578"
        }
    }
    if (account.eventID != event.eventID) {
        log.fatal("addAccountToEvent: eventID of account and eventID of event do not match !!!", account, event);
        throw "!!! addAccountToEvent: eventID of account and eventID of event do not match !!!";
    }
    event.accounts[account.accountID] = account;

    log.debug("Register new account/provider with event service");
    let provider = createProviderFromAccountAndUser(account, spotifyUser);
    try {
        const playlist = await request({
            method: 'POST',
            uri: PLAYLIST_PROVIDER_URL + 'events/' + account.eventID + '/providers',
            body: provider,
            json: true,
            timeout: 1000
        });
        log.trace("playlist from event service after register new account", playlist);
        if (playlist && playlist.isPlaying && playlist.currentTrack && playlist.currentTrack.id && playlist.currentTrack.provider.startsWith('spotify')) {
            log.trace("playlist is currently playing a spotify track - let's play it on the new account, too");
            const track = playlist.currentTrack;
            const pos = (Date.now() - Date.parse(track.started_at));
            await play(event, account, track.id, pos > 0 ? pos : 0);
            trackStarted = true;
        }

    } catch (err) {
        log.error("addAccountToEvent register with event failed ?!", err);
        throw {
            msg: "addAccountToEvent register with event failed?!",
            code: "SPTY-579"
        }            
    }

    log.trace('end addAccountToEvent trackStarted=', trackStarted);
    return trackStarted;
}

async function removeAccountFromEvent(event, account) {
    log.trace('begin removeAccountFromEvent');
    delete event.accounts[account.accountID];
    let newListOfProviders = await request({
        method: 'DELETE',
        uri: PLAYLIST_PROVIDER_URL + 'events/' + account.eventID + '/providers',
        body: { id: account.accountID },
        json: true,
        timeout: 1000
    });

    try {
        await pause(account);
    } catch (err) {
        log.debug("pause failed when removing account - ignored", err);
    }

    log.debug('newListOfProviders', newListOfProviders);
    log.trace('begin removeAccountFromEvent');
    return newListOfProviders;
}




// We are using "Authorization Code Flow" as we need full access on behalf of the user.
// Read https://developer.spotify.com/documentation/general/guides/authorization-guide/ to
// understand this, esp. the references to the the steps.
// step1: - generate the login URL / redirect....
router.get('/events/:eventID/providers/spotify/login', async function(req, res) {
    log.debug("getSpotifyLoginURL");
    let eventID = req.params.eventID;
    let spotifyApi = getTemporarySpotifyApi();
    let user = req.query.user;
    let state = eventID + '-' + (user ? user : '???');
    let authorizeURL = spotifyApi.createAuthorizeURL(spotifyScopes, state);
    log.debug("authorizeURL=%s", authorizeURL);

    // redirect to spotify auth/consent page flow:
    res.redirect(authorizeURL);
});

// This is Step 2 of the Authorization Code Flow:
// Redirected from Spotify AccountsService after user Consent.
// We receive a code and need to trade that code into tokens:
router.get('/auth_callback', async function(req, res) {
    log.trace("auth_callback start req=%s", JSON.stringify(req.query));
    let code = req.query.code;
    let state = req.query.state;
    let splitter = req.query.state.split("-");
    let eventID = splitter[0];
    let user = splitter[1];
    log.debug("code = %s, state=%s, event=%s, user=%s", code, state, eventID, user);

    try {
        // Trade CODE into TOKENS:
        log.debug("authorizationCodeGrant with code=%s", code);
        let spotifyApi = getTemporarySpotifyApi();
        let tokenData = await spotifyApi.authorizationCodeGrant(code);

        log.debug('Before we can use the API, we need to set access_token=%s', tokenData.body.access_token);
        spotifyApi.setAccessToken(tokenData.body.access_token);

        log.debug("Get information about user from spotify");
        let spotifyUser = await spotifyApi.getMe();
        log.trace("spotifyUser", spotifyUser.body);

        log.debug("Build account object with spotify user for eventID=", eventID);
        let event = await getEvent(eventID);
        let accountID = spotifyUser.body.id;
        let account = getAccountForEvent(event, accountID);
        updateTokensFromSpotifyBody(account, tokenData.body);
        updateAccountFromSpotifyUser(account, spotifyUser.body, user);

        log.debug("Auto select device for new account");
        await autoSelectDevice(spotifyApi, account, event);

        log.debug("Test play bohemian rhapsody to ensure it really works on device ", account.currentDevice);
        await spotifyApi.play({ uris: ["spotify:track:4u7EnebtmKWzUH433cf5Qv"], device_id: account.currentDevice });

        log.debug("Don't forget to stop it after 10seconds")
        let stopFreddy = setTimeout(async function() {
            try {
                await spotifyApi.pause({ device_id: account.currentDevice });
            } catch (err) {
                log.trace("pause failed after auth callback test play - ignored", err);
            }

        }, 10000);

        log.debug('Hooray, all worked out! Now store the new account.');
        const trackStarted = await addAccountToEvent(event, account, spotifyUser.body);
        fireEventStateChange(event);
        if (trackStarted) {
            log.debug("Track of playlist started, we can cancel stop of bohemian rhapsody");
            clearTimeout(stopFreddy);
        }

        log.debug("All done - redirect user to next page");
        // TODO: Depends on role owner->edit, user->playlist
        // Which Page to continue with after successful spotify login
        // To the event login page: let continueWith = "/" + eventID;
        // To the curator page: let continueWith = "/ui/playlist-curator";
        // To the create/edit event page:
        let continueWith = "";
        let msg = "";
        if (trackStarted) {
            log.trace("Event is already running, so it is probably a user");
            continueWith = "/ui/playlist-user";
            msg = "Spotify Authorization was successful, Spotify Device should be playing the current track of the playlist - you will be redirected to the playlist in 10 seconds.";
        } else {
            log.trace("No track started, probably a new event and the owner");
            continueWith = "/ui/event-edit";
            msg = "Spotify Authorization was successful, Spotify Device should be playing Bohemian Rhapsody for the next 10 seconds.";
        }

        res.send("<html><head><meta http-equiv=\"refresh\" content=\"10;url=" + continueWith + "\"/></head><body><h1>" + msg + "</h1></body></html>");
    } catch (err) {
        log.trace("auth shit happened!", err)
        let errTxt = '' + JSON.stringify(err);
        let msg = '<html><body><h1>';
        if (errTxt.includes('Forbidden')) {
            log.trace('forbidden');
            msg = 'Spotify Login was successful, but playing a song failed (forbidden).<br>Probably you have a Spotify Free account. Sorry, that does not work.<br>Please upgrade to Spotify Premium! The free trial period is sufficient for OpenDJ!<br>(SPTY-333)';
        } else if (errTxt.includes('Not Found') || errTxt.includes('SPTFY-100')) {
            log.trace('not found');
            msg = 'Spotify Login was successful, but playing a song failed due to no device available.<br>On the device you want to listen to the playlist, press play on the desired device to ensure the device is active.<br>Then try again.<br>(SPTY-334)';
        } else {
            log.error("authorizationCodeGrant processing failed for event %s with err", eventID, err);
            msg = "Something unexpected went wrong!<br><br>" + errTxt;
        }
        msg = msg + '<br><br><a href="/' + eventID + '">Return to OpenDJ</>'
        msg = msg + '</h1></body></html>'
        res.send(msg);
    }
});

// Step 3 is using the access_token - omitted here for obvious reasons.

// Step 4 of the flow - refresh tokens!
async function refreshAccessTokenForAccount(event, account) {
    let stateChanged = false;
    log.trace("begin refreshAccessToken eventID=%s, account=%s", event.eventID, account.display);

    /*
        if (account.eventID != event.eventID) {
            throw "!!! refreshAccessTokenForAccount: eventID of account and event to not match !!!";
        }
    */
    if (!account.token_expires) {
        log.error("refreshAccessToken: event has no token_expires, nothing to do here");
        return false;
    }

    let expTs = Date.parse(account.token_expires);
    let expTsOrig = expTs;
    let now = Date.now();

    // Access token is valid typically for 1hour (3600seconds)
    // We refresh it a bit before it expires , to ensure smooth transition:
    expTs = expTs - SPOTIFY_REFRESH_TOKEN_OFFSET;

    // To avoid that several pods refresh at the same time, we add some random
    // value to the offset:
    expTs = expTs - Math.floor(Math.random() * SPOTIFY_REFRESH_TOKEN_OFFSET_RANDOM);

    if (log.isDebugEnabled()) {
        log.debug("refreshAccessToken: expTsOrig=%s", new Date(expTsOrig).toISOString());
        log.debug("refreshAccessToken: expTs    =%s", new Date(expTs).toISOString());
        log.debug("refreshAccessToken: now      =%s", new Date(now).toISOString());
    }

    if (expTs < now) {
        stateChanged = true;
        try {
            log.debug("refreshAccessToken: access token for eventID=%s-%s is about to expire in %s sec - initiating refresh... ", event.eventID, account.display, (expTsOrig - now) / 1000);
            let api = getSpotifyApiForAccount(account);
            let tokenData = await api.refreshAccessToken();
            log.info("access token for eventID=%s is expired - initiating refresh...SUCCESS", event.eventID);
            updateTokensFromSpotifyBody(account, tokenData.body);
        } catch (err) {
            log.error('Could not refresh access token', err);
            account.token_refresh_failures++;

            if (account.token_refresh_failures > 5) {
                log.info("Removing account %s-%s due to %d token refresh failures", event.eventID, account.display, account.token_refresh_failures)
                await removeAccountFromEvent(event, account);
            }
        }
    } else {
        log.debug("refreshAccessToken: token for eventID=%s is still valid", event.eventID);
    }
    log.trace("end refreshAccessToken eventID=%s", event.eventID);

    return stateChanged;
}

async function refreshAccessTokensForEvent(event) {
    log.trace('begin refreshAccessTokensForEvent');
    let stateChanged = false;
    for (const account of Object.values(event.accounts)) {
        stateChanged = stateChanged | await refreshAccessTokenForAccount(event, account);
    }
    if (stateChanged) {
        log.debug('refreshAccessTokensForEvent: at least one account got refreshed, saving new state.');
        fireEventStateChange(event);
    }
    log.trace('end refreshAccessTokensForEvent');
}

async function refreshExpiredTokens() {
    log.trace("refreshExpiredTokens begin");
    try {
        let it = await cacheState.iterator(10);
        let entry = await it.next();

        while (!entry.done) {
            let event = JSON.parse(entry.value);
            log.trace("refreshExpiredTokens eventID =", event.eventID);
            await ensureNewEventVersionWithAccounts(event);
            await refreshAccessTokensForEvent(event);
            entry = await it.next();
        }
        await it.close();

        readyState.refreshExpiredTokens = true;
    } catch (err) {
        readyState.refreshExpiredTokens = false;
        log.fatal("!!! refreshExpiredTokens failed with err", err)
        handleFatalError();
    }

    log.trace("refreshExpiredTokens end");
}

// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// ----------------------- spotify track logic ------------------------------
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------

const mapOfSimpleGenres = new Map();
const mapOfGenreCoordinates = new Map(); // Key: String Genre Name, Value: {x, y, w}

async function loadSimplifiedGenresFromFile() {
    log.trace("begin loadSimplifiedGenresFromFile");
    let rl = readline.createInterface({
        input: fs.createReadStream('genresSimplified.txt')
    });

    let line_no = 0;
    rl.on('line', function(line) {
        line_no++;
        mapOfSimpleGenres.set(line, line_no);
    });
    rl.on('close', function(line) {
        log.info('Loaded %s simple genres', line_no);
    });
}

function loadGenreMapFromFile() {
    const genreMap = require("./genreMap/genreMap.json");
    // Genre Map provides absolute coordinates for each genre.
    // We want to provide normalized coordinates ranging from 0.0 -> 1.0
    // Thus we iterate of of genres
    for (let genre in genreMap.genres) {
        const genreDataAbs = genreMap.genres[genre];
        const genreDataNorm = {
            x: genreDataAbs.x / genreMap.width,
            y: genreDataAbs.y / genreMap.height,
            w: genreDataAbs.w / 100.0
        }
        mapOfGenreCoordinates.set(genre, genreDataNorm);
    }
    log.info('Loaded genre map with %s genres', mapOfGenreCoordinates.size);
}

function getFirstGenreFromComplexGenreString(complexGenreString) {
    return complexGenreString.split(",")[0];

}
// Reduces a genre string like
// "album rock, blues-rock, classic rock, hard rock, psychedelic rock, rock"
// to simple "rock"
function simplifyGenre(complexGenreString) {
    log.trace("begin simplifyGenre");

    let simpleGenre = null;

    if (complexGenreString) {
        // in 90% of all cases, we have something like "album rock", "hard rock"
        // So we take the first genre, take the last word and check if this is in our map
        // of simple genres. In the example, this would be "rock":
        let genres = complexGenreString.split(", ");
        for (let i = 0; i < genres.length && !simpleGenre; i++) {
            let genre = genres[i];
            let words = genre.split(' ');
            let lastWord = words[words.length - 1];
            if (mapOfSimpleGenres.has(lastWord)) {
                simpleGenre = lastWord;
            } else {
                // Hm, the last word only did not work. Maybe we look at something like "hip hop", so
                // let's try the last two words:
                if (words.length >= 2) {
                    let lastTwoWords = words[words.length - 2] + ' ' + words[words.length - 1];
                    if (mapOfSimpleGenres.has(lastTwoWords)) {
                        simpleGenre = lastTwoWords;
                    }
                }
            }

            if (!simpleGenre) {
                // Maybe I am thinking to complex and things are very very easy:
                if (mapOfSimpleGenres.has(genre)) {
                    simpleGenre = genre;
                }
            }
        }

        if (!simpleGenre) {
            log.info("Could not simplify genre %s", complexGenreString);
        }
    }


    if (!simpleGenre) {
        // Last Resort - we simply dont know:
        simpleGenre = "unknown";
    }

    log.trace("end simplifyGenre");
    return simpleGenre;
}

function mapSpotifyTrackToOpenDJTrack(sptTrack) {
    let odjTrack = {};
    odjTrack.id = sptTrack.id;
    odjTrack.name = sptTrack.name;

    odjTrack.artist = "";
    for (let i = 0; i < sptTrack.artists.length; i++) {
        if (i > SPOTIFY_TRACK_DETAIL_NUM_ARTISTS) break;
        if (i > 0) odjTrack.artist += ", ";
        odjTrack.artist += sptTrack.artists[i].name;
    }

    if (sptTrack.album.release_date) {
        odjTrack.year = parseInt(sptTrack.album.release_date.substring(0, 4));
    } else {
        odjTrack.year = 4242;
    }


    // Use the album images. Spotify returns widest first, we want the smallest, thus
    // we return the last:
    if (sptTrack.album.images.length > 0) {
        odjTrack.image_url = sptTrack.album.images[sptTrack.album.images.length - 1].url;
        odjTrack.image_url_ref = sptTrack.album.external_urls.spotify;
    } else {
        // TODO: Return URL to OpenDJ Logo
        odjTrack.image_url = "";
    }

    odjTrack.duration_ms = sptTrack.duration_ms;
    odjTrack.preview = sptTrack.preview_url;
    odjTrack.previewViaApp = sptTrack.external_urls.spotify;
    odjTrack.popularity = sptTrack.popularity;
    odjTrack.provider = "spotify";

    return odjTrack;
}


function mapSpotifySearchResultToOpenDJSearchResult(spotifyResult) {
    let result = [];
    for (let sptTrack of spotifyResult.tracks.items) {
        result.push(mapSpotifyTrackToOpenDJTrack(sptTrack));
    }

    return result;
}

function timesCharExistInString(str, chr) {
    let total = 0,
        last_location = 0,
        single_char = (chr + '')[0];
    while (last_location = str.indexOf(single_char, last_location) + 1) {
        total = total + 1;
    }
    return total;
};

function collapseArrayIntoSingleString(currentString, arrayOfStrings, maxEntries) {
    log.trace("begin collapseArrayIntoSingleString current=%s, array=%s, max=%i", currentString, arrayOfStrings, maxEntries);
    let result = currentString;

    if (arrayOfStrings && arrayOfStrings.length > 0) {
        let numEntries = timesCharExistInString(result, ',');
        if (numEntries == 0 && currentString.length > 0) numEntries = 1;

        for (let i = 0; i < arrayOfStrings.length; i++) {
            if (numEntries >= maxEntries) break;
            if (result.length > 0) result += ", ";
            log.trace("adding %s", arrayOfStrings[i]);
            result += arrayOfStrings[i];
            numEntries++;
        }
    }
    log.trace("end collapseArrayIntoSingleString result=%s", result);
    return result;
}

function mapSpotifyTrackResultsToOpenDJTrack(trackResult, albumResult, artistResult, audioFeaturesResult) {
    log.trace("begin mapSpotifyTrackResultsToOpenDJTrack");
    let result = {};
    if (trackResult && trackResult.body) {
        result = mapSpotifyTrackToOpenDJTrack(trackResult.body);
    }

    // ---- Genre ----
    result.genre = "";
    if (albumResult && albumResult.body) {
        log.trace("adding  genres >%s< from album", albumResult.body.genres);
        result.genre = collapseArrayIntoSingleString(result.genre, albumResult.body.genres, SPOTIFY_TRACK_DETAIL_NUM_GENRES);
        log.trace("genre after album.genres=%s", result.genre);
    }

    if (artistResult && artistResult.body) {
        log.trace("adding  genres >%s< from artist", artistResult.body.genres);
        result.genre = collapseArrayIntoSingleString(result.genre, artistResult.body.genres, SPOTIFY_TRACK_DETAIL_NUM_GENRES);
        log.trace("genre after artist.genres=%s", result.genre);
    }
    result.genreSimple = simplifyGenre(result.genre);
    result.genreSimpleNum = mapOfSimpleGenres.get(result.genreSimple);

    // ----- Genre-Map -----
    const firstGenre = getFirstGenreFromComplexGenreString(result.genre);
    log.trace("genreMap: first=>%s<", firstGenre);
    result.genreMap = mapOfGenreCoordinates.get(firstGenre);
    if (!result.genreMap) {
        log.info('no genreMap for %s', firstGenre);
        result.genreMap = {
            x: 0.5,
            y: 0.5,
            w: 0.0
        };
    }

    // ----- Track Meta Data -----
    if (audioFeaturesResult && audioFeaturesResult.body) {
        result.danceability = Math.round(audioFeaturesResult.body.danceability * 100);
        result.energy = Math.round(audioFeaturesResult.body.energy * 100);
        result.acousticness = Math.round(audioFeaturesResult.body.acousticness * 100);
        result.instrumentalness = Math.round(audioFeaturesResult.body.instrumentalness * 100);
        result.liveness = Math.round(audioFeaturesResult.body.liveness * 100);
        result.happiness = Math.round(audioFeaturesResult.body.valence * 100);
        result.bpm = Math.round(audioFeaturesResult.body.tempo);
    } else {
        result.danceability = -1;
        result.energy = -1;
        result.acousticness = -1;
        result.instrumentalness = -1;
        result.liveness = -1;
        result.happiness = -1;
        result.bpm = -1;
    }

    log.trace("end mapSpotifyTrackResultsToOpenDJTrack");
    return result;
}

function mapSpotifyPlaylistToOpenDJPlaylist(playlist) {
    return {
        id: playlist.id,
        name: playlist.name,
        numTracks: playlist.tracks.total,
        desc: playlist.description
    };
}

async function getTrackDetails(account, trackID) {
    log.trace("begin getTrackDetails eventID=%s-%s, trackID=%s", account.eventID, account.display, trackID);

    let trackResult = null;
    let audioFeaturesResult = null;
    let albumResult = null;
    let artistResult = null;
    let result = null;
    let api = getSpotifyApiForAccount(account);

    // If TrackID contains a "spotify:track:" prefix, we need to remove it:
    let colonPos = trackID.lastIndexOf(":");
    if (colonPos != -1) {
        trackID = trackID.substring(colonPos + 1);
    }

    // CACHING, as the following is quite Expensive, and we would like
    // to avoid to run into Spotify API rate limits:
    try {
        result = await getFromCache(cacheTracks, "spotify:" + trackID);
    } catch (cacheFailed) {
        log.warn("DataGrid GET TRACKS failed - ignoring error %s", cacheFailed);
    }

    if (result && result.genreMap) {
        log.debug("trackDetails cache hit");
    } else {
        log.debug("trackDetails cache miss");

        // We have to make four calls - we do that in parallel to speed things up
        // The problem is the "Genre" Result - it's not stored with the track, but with
        // either the album or the artist. So here we go:
        // #1: Get basic Track Result:
        log.trace("getTrack()");
        trackResult = api.getTrack(trackID);

        // #2: Get get Track Audio Features (danceability, energy and stuff):
        log.trace("getAudioFeaturesForTrack()");
// DFR 2025-12-25: This creates a 403???:
        //        audioFeaturesResult = api.getAudioFeaturesForTrack(trackID);

        // When we have trackResult we get the album and artist ID , and with that, we can make call
        // #3 to get album details and ...
        try {
            log.trace("awaiting trackResult");
            trackResult = await trackResult;
        } catch (err) {
            log.info("getTrack() failed with error:" + err);

            // Need to handle audioFeaturesResult which might respond later to avoid "unhandeled promise rejection warnings" - we can ignore that one.
            audioFeaturesResult.catch(function(err2) {
                log.debug("ignoring concurrent GetaudioFeatureResult error while handling getTrack() err=%s" + err2);
            });

            // Rethrow original error:
            throw err;
        }

        if (trackResult && trackResult.body && trackResult.body.album && trackResult.body.album.id) {
            log.trace("getAlbum()");
            albumResult = api.getAlbum(trackResult.body.album.id);
        }

        // ... call #4 to get Artist Result:
        if (trackResult && trackResult.body && trackResult.body.artists && trackResult.body.artists.length > 0) {
            log.trace("getArtist()");
            artistResult = api.getArtist(trackResult.body.artists[0].id);
        }

        // Wait for all results to return:
        // Error Handling is a bit ugly, but needs to be done to avoid "Unhandled promise rejections" messages,
        // which could kill the process in the future of nodejs.
        try {
            log.trace("await albumResult")
            albumResult = await albumResult;
        } catch (err) {
            log.info("error while await album for ignoring err=" + err);
        }

        try {
            log.trace("await audioFeaturesResult");
            audioFeaturesResult = await audioFeaturesResult;
        } catch (err) {
            log.info("error while await audio features for track- ignoring err=" + err);
        }

        try {
            log.trace("await artistResult");
            artistResult = await artistResult;
        } catch (err) {
            log.info("error while await audio artist  for track %s - ignoring err=" + err, trackID);
        }

        /* FOR DEBUGGING:
            result = {
                track: trackResult,
                album: albumResult,
                artist: artistResult,
                audioFeaturesResult: audioFeaturesResult,
                result: result,
            });
         */
        result = mapSpotifyTrackResultsToOpenDJTrack(trackResult, albumResult, artistResult, audioFeaturesResult);

        // Cache result:
        putIntoCacheAsync(cacheTracks, "spotify:" + trackID, result);
    }

    log.trace("end getTrackDetails");
    return result;
}


async function pause(account) {
    log.trace("begin pauseAccount");

    let api = getSpotifyApiForAccount(account);

    //    await api.pause({ device_id: account.currentDevice });
    await api.pause();
    log.info("PAUSE eventID=%s-%s", account.eventID, account.display);

    log.trace("end pauseAccount");
}


async function pauseEvent(event) {
    log.trace("begin pauseEvent");

    // Fan out calls for every account in parallel:
    let parallelCalls = [];
    for (const account of Object.values(event.accounts)) {
        parallelCalls.push(pause(account));
    }
    await Promise.all(parallelCalls);

    log.trace("end pauseEvent");
}

async function play(event, account, trackID, pos) {
    log.trace("begin play");

    log.debug("play eventID=%s-%s, trackID=%s, pos=%s", account.eventID, account.display, trackID, pos);
    let api = getSpotifyApiForAccount(account);
    let result = {
        status: 'ok',
        code: "SPTFY-542",
        msg: "OK-" + account.display,
        msgShort: "",
    }

    if (!account.play_failures)
        account.play_failures = 0;


    // If TrackID contains a "spotify:track:" prefix, we need to remove it:
    let colonPos = trackID.lastIndexOf(":");
    if (colonPos != -1) {
        trackID = trackID.substring(colonPos + 1);
    }
    let uris = ["spotify:track:" + trackID];
    let options = { uris: uris };

    log.trace('Ask Spotify about current device to honor ad hoc device selection');
    let currentState = await api.getMyCurrentPlaybackState();
    log.trace('currentState from spotify is ', currentState.body);
    if (currentState && currentState.body && currentState.body.device && currentState.body.device.id) {
        log.debug("Using device from current playback state")
        account.currentDevice = currentState.body.device.id;
    }
    if (account.currentDevice) {
        log.debug("account has currentDevice set - using it");
        options.device_id = account.currentDevice;
    }
    if (pos) {
        options.position_ms = pos;
    }

    log.trace("play options: ", options);

    // play sometimes fails on first try, probably due to comm issues
    // with the device. Thus we re-try
    // before getting into fancy error handling:
    try {
        await promiseRetry(function(retry, number) {
            log.debug("call spotify play, try #", number);
            return api.play(options).catch(retry);
        }, { retries: SPOTIFY_RETRIES, minTimeout: SPOTIFY_RETRY_TIMEOUT_MIN, maxTimeout: SPOTIFY_RETRY_TIMEOUT_MAX });

        log.info("PLAY ok %s#%s", account.eventID, account.display);
        account.play_failures = 0;
    } catch (err) {
        log.debug("play failed with err=%s - will try to handle this", err);
        account.play_failures++;
        try {
            // res.status(200).send({ code: "SPTFY-200", msg: "needed to handle spotify error, maybe device was changed!" });
            await handlePlayError(err, options, event, account, api);
            log.debug("play was successful after handling initial error");
        } catch (err2) {
            let msgShort = "WTF";
            log.debug("play failed after handling initial error with new error", err2);
            let message = "Play failed for Spotify account " + account.display + ".";
            if (("" + err).includes("Not Found")) {
                message += " Spotify could not find the device. Ensure that it is active by pressing play on the device, then press play in OpenDJ again. Or remove this account using the edit event page.";
                msgShort = "" + account.display + ": device not found";
            } else {
                message += " Initial Error was " + err;
                msgShort = "" + account.display + ": strange";
            }

            result = {
                status: 'error',
                code: "SPTFY-500",
                msg: message,
                msgShort: msgShort
            };
            log.info("PLAY err %s#%s", account.eventID, msgShort);

            if (account.play_failures >= MAX_PLAY_ERRORS && !account.display.includes(event.owner)) {
                log.info("PLAY err limit reached - account %s#%s is removed", account.eventID, account.display);
                try {
                    await removeAccountFromEvent(event, account);
                } catch (err) {
                    log.error("removeAccountFromEvent failed after max play error reached - this is ignored", err);
                }
            }

        }
        log.trace("end first catch");
    }

    log.trace("end play", result);
    return result;
}

async function playEvent(eventID, trackID, pos) {
    log.trace("begin playEvent eventID=%s, trackID=s, pos=%s", eventID, trackID, pos);

    let event = await getEvent(eventID);
    let accounts = Object.values(event.accounts);

    if (!accounts || accounts.length == 0) {
        throw {
            code: "SPTFY-513",
            msg: "No Spotify Accounts registered with event, can't play Spotify track. Please select 'Edit Event' from the menu and add Spotify",
        };
    }

    log.debug("Fan out play calls for %s account(s) in parallel", accounts.length);
    let parallelCalls = [];
    for (const account of accounts) {
        parallelCalls.push(play(event, account, trackID, pos));
    }

    log.debug("Join all parallel calls");
    let results = await Promise.all(parallelCalls);

    log.debug("Play can modify state (failure counters, current device. Save it:");
    fireEventStateChange(event);

    if (parallelCalls.length > 1) {
        log.debug("Count Number of ok/err play calls");
        let playOk = 0;
        let playErr = 0;
        let msgsConcatenated = "";
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status == "ok") { playOk++; }
            if (r.status == "error") {
                playErr++;
                msgsConcatenated += r.msgShort + "\n"
            }
        }

        log.debug("Sanity checking counts: playOk=%s, playErr=%s, len=%s", playOk, playErr, parallelCalls.length);
        log.debug("Escalate if more then 50% of calls failed");
        const percentageFailed = playErr / parallelCalls.length * 100.0;
        if (percentageFailed >= 50) {
            log.debug("%s percent of play calls failed - async call pause to stop the ones that are playing", percentageFailed);
            pauseEvent(event)
                .catch(pauseErr => log.debug("async pauseEvent after play error is ignored", pauseErr));

            log.debug("Now escalate");
            throw {
                code: "SPTFY-501",
                msg: "Play failed for majority of accounts:\n" + msgsConcatenated
            }
        }
    } else {
        log.debug("Only one account - escalate original error if there was one");
        if (results[0].status == 'error') {
            throw results[0];
        }
    }

    log.trace("end playEvent");
}

async function handlePlayError(err, options, event, account, api) {
    log.debug("Play failed despite retry. err=" + err);
    if (SPOTIFY_AUTOSELECT_DEVICE && ("" + err).includes("Not Found")) {
        log.debug("expected shit happend - device not found - try autoselect a device");
        let deviceChanged = await autoSelectDevice(api, account, event);
        if (deviceChanged) {
            fireEventStateChange(event);

            log.debug("AutoSelect did change device setting, so play it again, same!");
            options.device_id = account.currentDevice;
            await promiseRetry(function(retry, number) {
                log.debug("call spotify play, try #", number);
                return api.play(options).catch(retry);
            }, { retries: SPOTIFY_RETRIES, minTimeout: SPOTIFY_RETRY_TIMEOUT_MIN, maxTimeout: SPOTIFY_RETRY_TIMEOUT_MAX });
        } else {
            log.error("handlePlayError: autoSelectDevice did not change device setting, escalating initial problem");
            throw err;
        }
    } else {
        log.debug("unexpected shit happened, or autoplay is disabled - we can do nothing here");
        throw err;
    }
}


async function autoSelectDevice(api, account, event) {
    log.trace("begin autoSelectDevice");

    log.debug("Asking spotify about available devices");
    let data = await api.getMyDevices()
    log.trace("Response from spotify getMyDevices: ", data.body);
    let devices = data.body.devices;
    let result = false;
    if (devices.length == 0) {
        log.debug("device list is empty");
        throw { code: "SPTFY-100", msg: "No devices available - Please start spotify on the desired playback device" };
    }
    // Per default, we take the first device. If there is an active
    // one, we prefer that:
    let device = devices[0];
    for (let otherDevice of devices) {
        if (otherDevice.is_active) {
            log.debug("selecting active device ", otherDevice.name);
            device = otherDevice;
            break;
        }
    }
    let deviceId = device.id;

    if (deviceId != event.currentDevice) {
        log.info("AUTOSELECT device %s for %s-%s", device.name, event.eventID, account.display);
        account.currentDevice = deviceId;
        result = true;
    } else {
        log.info("AUTOSELECT: no (new) device found");
        result = false;
    }
    log.trace("end autoSelectDevice result=", result);
    return result;
}

async function changeVolumeForAccount(account, action) {
    log.trace('begin changeVolumeForAccount');
    let api = getSpotifyApiForAccount(account);
    let currentState = await api.getMyCurrentPlaybackState();
    let result = undefined;

    if (currentState && currentState.body && currentState.body.device && currentState.body.device.volume_percent) {
        let oldVolume = currentState.body.device.volume_percent;
        let newVolume = oldVolume;
        let deviceName = currentState.body.device.type + " " + currentState.body.device.name;
        if (action == 'inc') {
            newVolume += 5;
        } else if (action == 'dec') {
            newVolume -= 5;
        }
        if (newVolume > 100) newVolume = 100;
        if (newVolume < 0) newVolume = 0;

        if (newVolume != oldVolume) {
            log.debug("Change volume to ", newVolume);
            try {
                await api.setVolume(newVolume, { device_id: account.currentDevice });
                result = { oldVolume: oldVolume, newVolume: newVolume }
            } catch (error) {
                if (error.statusCode == 403) {
                    throw {
                        "msg": "Sorry, the active spotify device " + deviceName + " for account " + account.display + " does not allow volume control",
                        "code": "SPTY-642"
                    };
                } else if (error.statusCode == 404) {
                    throw {
                        "msg": "Spotify Device " + deviceName + " for account " + account.display + " not found - is it still active? You could select a different device in event settings, or press play to let OpenDJ auto select device.",
                        "code": "SPTY-643"
                    };
                } else {
                    log.debug('changeVolumeForAccount error', error);
                    throw error;
                }
            }
        }

    } else {
        throw {
            "msg": "Can't get current volume from spotify account " + account.display + ". Is the device active? Press play in spotify app on that device to activate it, or select a different device in event settings.",
            "code": "SPTY-641"
        }
    }
    log.trace('end changeVolumeForAccount', result);
    return result;
}


// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ---------------------------  api routes ------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
if (COMPRESS_RESULT == 'true') {
    log.info("compression enabled");
    app.use(compression())
} else {
    log.info("compression disabled");

}

app.use(cors());
app.use(express.json());


function handleFatalError() {
    process.exit(44);
}

function handleError(err, response) {
    log.error('Error: ' + err);
    if (err.code && err.msg) {
        response.status(500).send(err);
    } else {
        response.status(500).send({
            "msg": "Call to Spotify failed?! Did the event owner provide credentials? Is the playback device active? Spotify says:" + err,
            "code": "SPTY-542"
        });

    }
}

router.get('/events/:eventID/providers/spotify/currentTrack', async function(req, res) {
    log.debug("getCurrentTrack");

    let eventID = req.params.eventID;
    let event = await getEvent(eventID);
    let api = getSpotifyApiForEvent(event);

    api.getMyCurrentPlaybackState({}).then(function(data) {
        log.debug("Now Playing: ", data.body);
        res.send(data.body);
    }, function(err) {
        handleError(err, res);
    });
});


async function getAvailableDevicesForAccount(account) {
    let api = getSpotifyApiForAccount(account);
    let data = await api.getMyDevices();

    let result = {
        availableDevices: [],
        currentDevice: account.currentDevice,
        accountID: account.accountID
    };

    // Map Spotify Devices to OpenDJ Devices:
    data.body.devices.forEach(device => {
        result.availableDevices.push({
            id: device.id,
            desc: device.type + " " + device.name + (device.is_active ? " - active" : " - passive"),
        });
    });

    return result;
}

router.get('/events/:eventID/providers/spotify/devices', async function(req, res) {
    log.trace("getAvailableDevices begin");

    try {
        let result = {};
        let eventID = req.params.eventID;
        let event = await getEvent(eventID);
        for (const account of Object.values(event.accounts)) {
            result[account.accountID] = await getAvailableDevicesForAccount(account);
        }
        res.send(result);
    } catch (error) {
        handleError(error, res);
    }

    log.trace("getAvailableDevices end");
});

router.post('/events/:eventID/providers/spotify/devices', async function(req, res) {
    log.trace("begin route post device");

    try {
        log.trace("route post device body=%s", req.body);

        let eventID = req.params.eventID;
        let event = await getEvent(eventID);
        let account = getAccountForEvent(event, req.body.accountID);
        let api = getSpotifyApiForAccount(account);
        account.currentDevice = req.body.currentDevice;

        let currentState = await api.getMyCurrentPlaybackState();
        log.debug("currentState=", currentState);
        if (currentState.body.device.id != event.currentDevice) {
            log.debug("transfer playback");
            await api.transferMyPlayback({ deviceIds: [event.currentDevice], play: currentState.body.is_playing })
        } else {
            log.debug("transfer not necessary, device is already current");
        }
        let result = await getAvailableDevicesForAccount(account);

        fireEventStateChange(event);

        res.status(200).send(result);
        log.debug("Event UPDATED eventId=%s, URL=%s", event.eventID, event.url);
    } catch (error) {
        log.error("route post device err = %s", error);
        res.status(500).send(JSON.stringify(error));
    }
    log.trace("end route post device");
});

router.post('/events/:eventID/providers/spotify/volume', async function(req, res) {
    log.trace("begin route post volume");

    try {
        log.trace("route post volume body=%s", req.body);

        const eventID = req.params.eventID;
        const event = await getEvent(eventID);
        let parallelCalls = [];
        for (const account of Object.values(event.accounts)) {
            parallelCalls.push(changeVolumeForAccount(account, req.body.action));
        }
        const result = await Promise.all(parallelCalls);
        res.status(200).send(result);
    } catch (error) {
        if ('code' in error) {
            log.debug('route post volume error', error);
        } else {
            log.error('route post volume error', error);
        }
        res.status(500).send(error);
    }
    log.trace("end route post volume");
});

router.delete('/events/:eventID/providers/spotify/:providerID', async function(req, res) {
    log.trace("begin route delete provider");

    try {
        log.debug("delete provider with event", req.params);
        let eventID = req.params.eventID;
        let accountID = req.params.providerID;
        let event = await getEvent(eventID);
        let account = getAccountForEvent(event, accountID);
        let newListOfProviders = await removeAccountFromEvent(event, account);
        fireEventStateChange(event);

        res.status(200).send(newListOfProviders);
    } catch (error) {
        log.error("route delete provider", error);
        res.status(500).send(JSON.stringify(error));
    }
    log.trace("end route delete provider");
});

router.get('/events/:eventID/providers/spotify/search', async function(req, res) {
    log.trace("begin searchTrack");
    try {
        let eventID = req.params.eventID;
        let query = req.query.q
        let event = await getEvent(eventID);
        let api = getSpotifyApiForEvent(event);

        let data = await api.searchTracks(query, { limit: SPOTIFY_SEARCH_LIMIT })
        res.send(mapSpotifySearchResultToOpenDJSearchResult(data.body));
    } catch (err) {
        handleError(err, res);
    }
    log.trace("end searchTrack");
});


router.get('/events/:eventID/providers/spotify/tracks/:trackID', async function(req, res) {
    log.trace("begin route get tracks");

    try {
        let event = await getEvent(req.params.eventID);
        let account = getAnyAccountForEvent(event);
        let result = await getTrackDetails(account, req.params.trackID);
        res.send(result);
    } catch (err) {
        log.error("trackDetails() outer catch err=", err);
        handleError(err, res);
    }

    log.trace("end route get tracks");
});

router.get('/events/:eventID/providers/spotify/pause', async function(req, res) {
    log.trace("begin pause route");

    try {
        let event = await getEvent(req.params.eventID);
        await pauseEvent(event);
        res.status(200).send("ok");
        log.info("PAUSE eventID=%s", req.params.eventID);
    } catch (err) {
        log.warn("pause failed!", err);
        res.status(500).send(err);
    }
    log.trace("end pause route");
});


router.get('/events/:eventID/providers/spotify/play/:trackID', async function(req, res) {
    log.trace("begin play route");

    try {
        let eventID = req.params.eventID;
        let trackID = req.params.trackID;
        let pos = req.query.pos;

        await playEvent(eventID, trackID, pos);
        res.status(200).send("ok");
    } catch (err) {
        log.debug("play route err", err);
        res.status(500).send(err);
    }
    log.trace("end play route");
});

router.get('/events/:eventID/providers/spotify/playlists', async function(req, res) {
    log.trace("begin get playlists");

    try {
        let eventID = req.params.eventID;
        let event = await getEvent(eventID);
        let api = getSpotifyApiForEvent(event);
        let data = await api.getUserPlaylists({ limit: "50" });
        let result = new Array();

        if (data.body.items) {
            data.body.items.forEach(element => result.push(mapSpotifyPlaylistToOpenDJPlaylist(element)));
        }

        res.send(result);
    } catch (err) {
        handleError(err, res);
    }
});

router.get('/events/:eventID/providers/spotify/playlist/:playlistID', async function(req, res) {
    log.trace("begin begin get playlist");

    try {
        let eventID = req.params.eventID;
        let playlistID = req.params.playlistID;
        let event = await getEvent(eventID);
        let api = getSpotifyApiForEvent(event);
        let result = new Array();

        let data = await api.getPlaylist(playlistID, { limit: 200, offset: 0 });
        if (data.body.tracks.items) {
            data.body.tracks.items.forEach(i => result.push("spotify:" + i.track.id));
        }

        res.send(result);
    } catch (err) {
        handleError(err, res);
    }
});

async function readyAndHealthCheck(req, res) {
    log.trace("begin readyAndHealthCheck");
    // Default: not ready:
    let status = 500;
    let gridOkay = false;
    try {
        gridOkay = await checkGridConnection();
    } catch (err) {
        readyState.lastError = 'CheckGridConnection: ' + err;
    }

    if (readyState.datagridClient &&
        readyState.refreshExpiredTokens &&
        gridOkay) {
        status = 200;
    }

    res.status(status).send(JSON.stringify(readyState));
    log.trace("end readyAndHealthCheck status=", status);
}

router.get('/ready', readyAndHealthCheck);
router.get('/health', readyAndHealthCheck);


router.get('/internal/dump', async function(req, res) {
    log.trace("begin dump");
    try {
        let it = await cacheState.iterator(10);
        let entry = await it.next();
        let result = [];

        while (!entry.done) {
            result.push(JSON.parse(entry.value));
            entry = await it.next();
        }
        await it.close();
        res.status(200).send(result);
    } catch (err) {
        res.status(500).send(err);
    }
});


router.get('/internal/searchPlaylist', async function(req, res) {
    log.trace("begin export_playlist");

    try {
        let query = req.query.q;
        let event = await getEvent('demo');
        let api = getSpotifyApiForEvent(event);

        let data = await api.searchPlaylists(query);
        res.send(data.body);
    } catch (err) {
        handleError(err, res);
    }
});

router.get('/internal/exportPlaylist', async function(req, res) {
    log.trace("begin export_playlist");

    try {
        let id = req.query.id;
        let delay = req.query.delay;
        let event = await getEvent('demo');
        let api = getSpotifyApiForEvent(event);
        let trackDetails = new Array;

        log.trace("geting playlist");
        let data = await api.getPlaylist(id, { limit: 200, offset: 0 });
        let tracks = data.body.tracks.items;
        if (!delay) {
            delay = 100;
        }

        let meta = {
            id: data.body.id,
            name: data.body.name,
            description: data.body.description,
            followers: data.body.followers.total,
            owner: data.body.owner.display_name,
            url: data.body.external_urls.spotify,
        };

        log.info("exportPlaylist: Getting track details for %s tracks.", tracks.length);
        for (let i = 0; i < tracks.length; i++) {
            let trackID = tracks[i].track.id;
            let trackDetail = await getTrackDetails(event, trackID);
            trackDetails.push(trackDetail);
            log.trace("TrackID=%s", trackID);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        // res.send(data.body);
        res.send(JSON.stringify({ meta: meta, tracks: trackDetails }, null, 4));
        // res.send({ meta: meta, tracks: trackDetails });

    } catch (err) {
        handleError(err, res);
    }
});

app.use("/api/provider-spotify/v1", router);

setImmediate(async function() {
    try {
        loadGenreMapFromFile();

        await loadSimplifiedGenresFromFile();

        await connectAllCaches();

        log.info("Initial token refresh");
        await refreshExpiredTokens();
        setInterval(refreshExpiredTokens, SPOTIFY_REFRESH_TOKEN_INTERVAL);

        app.listen(PORT, function() {
            log.info('Now listening on port *:' + PORT);
        });
    } catch (err) {
        log.fatal("!!!!!!!!!!!!!!!");
        log.fatal("init failed with err %s", err);
        log.fatal("Terminating now");
        log.fatal("!!!!!!!!!!!!!!!");
        process.exit(42);
    }
});
