import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';


@Injectable({
    providedIn: 'root'
})
export class ConfigService {

    enableDebug;
    curatorPassword;
    playlistMaxSize;
    websocketHost;
    websocketPath;
    SPOTIFY_PROVIDER_API;
    PLAYLIST_PROVIDER_API;
    WEB_PROVIDER_API;
    HELP_PAGE_URL;
    SERVER_TIMEOUT = 1000;


    constructor(public http: HttpClient) {}

    async loadConfigurationData() {
        console.debug('loadConfigurationData');

        let data = null; 
        
        try {
            console.debug('trying to load conf/config.loc.json');
            data = await this.http.get<any>('conf/config.loc.json').toPromise();
       
        } catch (error) {
            console.debug('local config loading failed - trying config.json');
            data = await this.http.get<any>('conf/config.json').toPromise();
        }
     
        console.debug('App config loaded: ' + JSON.stringify(data));
        this.enableDebug = data.enableDebug;
        this.curatorPassword = data.curatorPassword;
        this.playlistMaxSize = data.playlistMaxSize;
        this.websocketHost = data.websocketHost;
        this.websocketPath = data.websocketPath;
        this.WEB_PROVIDER_API = data.WEB_PROVIDER_API;
        this.SPOTIFY_PROVIDER_API = data.SPOTIFY_PROVIDER_API;
        this.PLAYLIST_PROVIDER_API = data.PLAYLIST_PROVIDER_API;
        this.SERVER_TIMEOUT = data.SERVER_TIMEOUT;
        this.HELP_PAGE_URL = data.HELP_PAGE_URL;
    }

}
