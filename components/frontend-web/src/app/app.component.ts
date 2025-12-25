import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MenuController, Platform, AlertController } from '@ionic/angular';
import { EventsService } from './providers/events.service';
import { SplashScreen } from '@ionic-native/splash-screen/ngx';
import { StatusBar } from '@ionic-native/status-bar/ngx';

import { UserDataService } from './providers/user-data.service';
import { UserSessionState } from './models/usersessionstate';
import { ConfigService } from './providers/config.service';
import { HttpClient } from '@angular/common/http';
import { retry, catchError, timeout } from 'rxjs/operators';
import { WebsocketService } from './providers/websocket.service';
import { MusicProvider } from './models/music-event';
import { FEService } from './providers/fes.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss']
})
export class AppComponent implements OnInit {

  userState = new UserSessionState();
  event = null;

  constructor(
    public platform: Platform,
    private splashScreen: SplashScreen,
    private statusBar: StatusBar,
    private events: EventsService,
    private router: Router,
    private menu: MenuController,
    private alertController: AlertController,
    private userDataService: UserDataService,
    private confService: ConfigService,
    private websocketService: WebsocketService,
    private feService: FEService,
    private http: HttpClient
  ) {
    this.initializeApp();
    this.registerEventSubscribers();
  }

  initializeApp() {
    this.platform.ready().then((readySource) => {
      console.debug(`Running on Platform: ${readySource}`);

      if (readySource === 'cordova') {
        this.statusBar.styleDefault();
        this.splashScreen.hide();
      }
    });
  }

  private async loadUserState() {
    console.debug('loadUserState');
    this.userState = await this.userDataService.getUser();
  }

  serverSideLogout(user: UserSessionState) {
    if (user &&  user.currentEventID ) {
      const url = this.confService.WEB_PROVIDER_API
      + '/events/' + user.currentEventID + '/user/logout';
      const body = { userState: user };

      console.debug('before post url=%s, body=%s', url, JSON.stringify(body));
      this.http.post(url, body)
          .pipe(
          timeout(this.confService.SERVER_TIMEOUT),
          retry(1)
          ).subscribe();
    }
  }


  registerEventSubscribers() {
    console.debug('registerEventSubscribers');

    this.events.subscribe('sessionState:modified', state => {
      console.debug('Received sessionState:modified event');
      this.userState = state;
      this.userDataService.updateUser(state);
    });

    this.events.subscribe('user:logout', data => {
      console.debug('Received user:logout event', data);
      let redirectUrl;
      if ( data && data.redirect ) {
        redirectUrl = data.redirect;
      } else {
        redirectUrl = 'ui/event/' + this.userState.currentEventID;
      }

      this.websocketService.destroy();
      this.serverSideLogout(this.userState);

      this.userState = new UserSessionState();
      this.userDataService.updateUser(this.userState);
      this.router.navigate([redirectUrl]);
    });

    this.userDataService.events.subscribe('user:modified', data => {
      console.debug('Received user:modified event from user data service');
      this.userState = data;
    });

    this.events.subscribe('event:modified', data => {
      console.debug('Received event:modified event');
      this.event = data;
    });

  }


  logout() {
    this.events.publish('user:logout');
  }

  home() {
    this.events.publish('user:logout', {redirect: 'ui/landing'});
  }

  help() {
    window.open(this.confService.HELP_PAGE_URL, '_blank');

  }

  getProviderForUser(): MusicProvider {
    for (const p of this.event.providers) {
      if (p.user === this.userState.username) {
        return p;
      }
    }
    return null;
  }

  userHasAddedSpotify() {
    const p = this.getProviderForUser();
    return p && p.type === 'spotify';
  }

  async addSpotify() {
    const alert = await this.alertController.create({
      header: 'Add Spotify',
      message: `To listen to the playlist on your own Spotify device, you need:

1. Start playing any song NOW on the Spotify device you want OpenDJ to play music. This ensures it is connected and active.

2. The username/password for your Spotify Premium account. (Free does not work, sorry)

3. Then press okay.`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'secondary seleniumCancel',
          handler: (data) => {

          }
        }, {
          text: 'Okay',
          cssClass: 'seleniumOkay',
          handler: () => {
            const href = `${this.confService.SPOTIFY_PROVIDER_API}/events/${this.event.eventID}/providers/spotify/login?user=${this.userState.username}`;
            console.debug('window open', href);

            window.open(href, '_blank');
          }
        }
      ]
    });
    await alert.present();
  }

  async removeSpotify() {
    const provider = this.getProviderForUser();
    if (provider) {
      this.feService.deleteProvider(this.event, provider).subscribe(
        result => {
          console.debug('Got new list of providers!');
          this.event.providers = result;
        }
      );
    }
  }


  async ngOnInit() {
    console.debug('ngOnInit()');
    await this.loadUserState();
  }

}
