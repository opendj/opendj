import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { UserSessionState } from '../models/usersessionstate';
import { EventsService } from './events.service';


@Injectable({
  providedIn: 'root'
})
export class UserDataService {
  HAS_LOGGED_IN = 'hasLoggedIn';
  IS_CURATOR = 'isCurator';
  USERNAME = 'username';
  private _storage: Storage | null = null;

  constructor(
    public events: EventsService,
    private storage: Storage
  ) {
    this.init();
  }

  async init() {
    const storage = await this.storage.create();
    this._storage = storage;
  }

  getUser(): Promise<UserSessionState> {
    console.debug('UserDataService: getUser');
    return this.storage.get('USER').then((value) => {
      if (!value) {
        console.debug('getUser -> state not found in local storage, returning new state');
        value = new UserSessionState();
      }
      return value;
    });
  }

  updateUser(u: UserSessionState) {
    console.debug('UserDataService: updateUser');
    this.storage.set('USER', u).then( () => {
      this.events.publish('user:modified', u);
    }).catch((err) => {
      console.error('updateUser -> failed', err);
    });
  }

  logout() {
    console.debug('UserDataService: logout');
    this.storage.clear().then( () => {
    });
    }

}
