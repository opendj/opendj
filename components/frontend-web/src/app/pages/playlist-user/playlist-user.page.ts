import { ConfigService } from '../../providers/config.service';
import { UserDataService } from '../../providers/user-data.service';
import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { ModalController, ActionSheetController, ToastController, Platform, IonSearchbar } from '@ionic/angular';
import { EventsService } from '../../providers/events.service';
import { WebsocketService } from 'src/app/providers/websocket.service';
import { MockService } from 'src/app/providers/mock.service';
import { FEService } from '../../providers/fes.service';
import { MusicEvent } from 'src/app/models/music-event';
import { Track } from 'src/app/models/track';
import { Playlist } from 'src/app/models/playlist';
import { Subscription } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { UserSessionState } from 'src/app/models/usersessionstate';

@Component({
  selector: 'app-playlist',
  templateUrl: 'playlist-user.page.html',
  styleUrls: ['playlist-user.page.scss']
})
export class PlaylistUserPage implements OnInit, OnDestroy {
  public selectedItem: any;

  currentEvent: MusicEvent = null;
  currentPlaylist: Playlist = null;
  subscriptions: Subscription[] = [];
  userState: UserSessionState;
  isConnected = false;
  intervalHandle = null;
  tooltipOptions = {
    placement: 'left',
    hideDelayTouchscreen: 2500,
    hideDelayAfterClick: 2500,
    trigger: 'click',
    'max-width': 300,
    'show-delay': 0
  };

  trackFeedback = {};

  constructor(
    public modalController: ModalController,
    public actionSheetController: ActionSheetController,
    private events: EventsService,
    public toastController: ToastController,
    public websocketService: WebsocketService,
    public mockService: MockService,
    public feService: FEService,
    public userDataService: UserDataService,
    public configService: ConfigService,
    public platform: Platform,
    private route: ActivatedRoute,
    public router: Router,
    ) {
  }


  async refresh(event) {
    console.debug('begin refresh');
    try {
      await this.refreshEvent();
      await this.refreshPlaylist();
    } catch (err) {
      console.error('Refresh failed!', err);
    } finally {
      if (event) {
        event.detail.complete();
      }
    }
    console.debug('end refresh');
  }

  getAddTrackButtonColor() {
    let result = 'primary';
    if (this.currentPlaylist && this.currentPlaylist.nextTracks && this.currentEvent) {
      const percentage = this.currentPlaylist.nextTracks.length / this.currentEvent.maxTracksInPlaylist;
      if (percentage >= 1.0) {
        result = 'danger';
      } else if (percentage > 0.9) {
        result = 'warning';
      }
    }
    return result;
  }

  isUserAboveContributionLimit() {
    let result = false;
    if (this.currentEvent && this.currentEvent.maxContributionsPerUser > 0 &&  this.currentPlaylist &&  this.currentPlaylist.nextTracks ) {
      let numContributions = 0;
      this.currentPlaylist.nextTracks.forEach(t => {
          if (t.added_by === this.userState.username) {
            numContributions++;
          }
      });

      result = numContributions >= this.currentEvent.maxContributionsPerUser;
    }

    return result;
  }

  date2hhmm(d): string {
    d = d.toTimeString().split(' ')[0];
    return d.substring(0, 5);
  }

  computeETAForTracks() {
    const playlist = this.currentPlaylist;
    let ts = Date.now();
    if (playlist.currentTrack) {
        ts += (playlist.currentTrack.duration_ms - playlist.currentTrack.progress_ms);
    }
    if (playlist.nextTracks) {
      // tslint:disable-next-line:prefer-for-of
      for (let i = 0; i < playlist.nextTracks.length; i++) {
          playlist.nextTracks[i].eta = this.date2hhmm(new Date(ts));
          playlist.nextTracks[i].pos = i;
          ts += playlist.nextTracks[i].duration_ms;
      }
    }
  }

  ensureFeedbackAttributes(track: Track) {
    if (!track.numLikes) {
      track.numLikes = 0;
    }
    if (!track.numHates) {
      track.numHates = 0;
    }
  }

  noPreview() {
    this.presentToast('Sorry, Spotify does not provide a preview for this track.');
  }

  ensureTrackFeedbackEmojis() {
    if (!this.currentEvent.emojiTrackLike) {
      this.currentEvent.emojiTrackLike = '🥰';
    }
    if (!this.currentEvent.emojiTrackHate) {
      this.currentEvent.emojiTrackHate = '🤮';
    }
  }



  isTrackLiked(track: Track) {
    return this.trackFeedback[track.id] === 'L';
  }

  isTrackHated(track: Track) {
    return this.trackFeedback[track.id] === 'H';
  }

  currentTrackFeedback(feedback: string) {
    console.debug('currentTrackFeedback', feedback);
    if (feedback === 'L') {
      this.trackLike(this.currentPlaylist.currentTrack);
    } else if (feedback === 'H'){
      this.trackHate(this.currentPlaylist.currentTrack);
    } else {
      throw new Error('Unexpected feedback for current track');
    }
  }

  trackLike(track) {
    console.debug('begin trackLike()');
    let oldFeedback = this.trackFeedback[track.id];
    let newFeedback = 'L';
    let message = '';

    this.ensureFeedbackAttributes(track);
    if (!oldFeedback) {
      oldFeedback = '';
    }

    if (oldFeedback === 'H' && newFeedback === 'L') {
      // User change her mind from hate to like, thus we need to reduce hate counter:
      track.numHates--;
    }

    if (oldFeedback === 'L' && newFeedback === 'L') {
      // User liked in the past and now clicked like again,
      // meaning to remove the like:
      track.numLikes--;
      newFeedback = '';
      message = 'Tack <b>liking</b> revoked';
    } else {
      track.numLikes++;
      message = 'Tack <b>likening</b> registered';
    }

    this.trackFeedbackSanityCheck(track);
    this.trackFeedback[track.id] =  newFeedback;
    this.updateUserStateWithTrackFeedback();
    this.feService.provideTrackFeedback(this.currentEvent, track, oldFeedback, newFeedback, this.userState).subscribe(
      updatedPlaylist => {
        this.handlePlaylistUpdate(updatedPlaylist);
      }
    );
    this.presentToast(message);
    }

  trackHate(track: Track) {
    console.debug('begin trackHate()');
    let oldFeedback = this.trackFeedback[track.id];
    let newFeedback = 'H';
    let message = '';

    this.ensureFeedbackAttributes(track);

    if (!oldFeedback) {
      oldFeedback = '';
    }

    if (oldFeedback === 'L' && newFeedback === 'H') {
      // User change her mind from like to hate, thus we need to reduce hate counter:
      track.numLikes--;
    }

    if (oldFeedback === 'H' && newFeedback === 'H') {
      // User liked in the past and now clicked like again,
      // meaning to remove the like:
      track.numHates--;
      newFeedback = '';
      message = 'Track <b>hating</b> revoked';
    } else {
      track.numHates++;
      message = 'Track <b>hating</b> registered';
    }
    this.trackFeedbackSanityCheck(track);
    this.trackFeedback[track.id] = newFeedback;
    this.updateUserStateWithTrackFeedback();
    this.feService.provideTrackFeedback(this.currentEvent, track, oldFeedback, newFeedback, this.userState).subscribe(
      updatedPlaylist => {
        this.handlePlaylistUpdate(updatedPlaylist);
      }
    );
    this.presentToast(message);
  }

  trackFeedbackSanityCheck(track: Track) {
    if (track.numLikes < 0) {
      track.numLikes = 0;
    }
    if (track.numHates < 0) {
      track.numHates = 0;
    }

  }

  updateUserStateWithTrackFeedback() {
    this.userState.trackFeedback = this.trackFeedback;
    this.userDataService.updateUser(this.userState);
  }

  async searchAndAddTrack() {
    if (this.getAddTrackButtonColor() === 'danger') {
      this.presentToast('Sorry, this playlist has reached max size. Please try later');
      return;
    }

    if (this.isUserAboveContributionLimit()) {
      this.presentToast('Sorry, you are above the contribution limit of ' + this.currentEvent.maxContributionsPerUser
      + ' tracks. Please let other users also contribute. Try later when your songs have been played.');
      return;
    }

    const modal = await this.modalController.create({
      component: PlaylistAddModalComponent,
      mode: 'md',
      componentProps: {
        currentEvent: this.currentEvent }
    });
    modal.onDidDismiss().then(res => {
      if (res.data) {
        this.feService.addTrack(this.currentEvent, res.data.id, 'spotify', this.userState.username).subscribe(
          data => {
            this.presentToast('Track added to playlist.');
          },
          err => console.error(err)
        );
      }
    });
    return await modal.present();
  }

  async presentToast(data) {
    const toast = await this.toastController.create({
      message: data,
      position: 'top',
      color: 'light',
      duration: 2000
    });
    toast.present();
  }

  trackElement(index: number, element: any) {
    return element ? element.id : null;
  }

  checkEverybodyIsCuratorStateChange() {
    if (this.userState.loginContext === 'user') {
      console.debug('Simple user detected - check if everybodyIsCurator did change');
      const oldCuratorState = this.userState.isCurator;
      const newCuratorState = this.currentEvent.everybodyIsCurator;
      if (oldCuratorState !== newCuratorState) {
        console.debug('everybodyIsCurator did change: newCuratorState=%s', newCuratorState);
        this.userState.isCurator = newCuratorState;
        this.userDataService.updateUser(this.userState);

        if (newCuratorState) {
          this.presentToast('Everbody is curator now - checkout the menu!');
        } else {
          this.presentToast('Sorry, everybody is curator right has been revoked by event owner');
        }
      }
    }
  }

  async refreshEvent() {
    console.debug('refreshEvent()');
    const eventID = this.userState.currentEventID;
    const newEvent = await this.feService.readEvent(eventID).toPromise();
    console.debug('refreshEvent(): received new event');
    this.currentEvent = newEvent;
    if (!this.currentEvent) {
      console.error('could not load event from server - something is wrong - redirect to logout');
      this.router.navigate([`ui/login`]);
      return;
    }
    this.events.publish('event:modified', this.currentEvent);
    this.checkEverybodyIsCuratorStateChange();
  }

  async refreshPlaylist() {
    console.debug('refreshPlaylist()');
    if (this.currentEvent) {
      console.debug('getCurrentPlaylist() from server');
      const newList = await this.feService.getCurrentPlaylist(this.currentEvent).toPromise();
      console.debug('refreshPlaylist(): received new Playlist');
      this.handlePlaylistUpdate(newList);
    } else {
      console.warn('refreshPlaylist() without currentEvent?!');
    }
  }

  handlePlaylistUpdate(newPlaylist) {
    if (newPlaylist) {
      console.debug('handlePlaylistUpdate')
      this.currentPlaylist = newPlaylist;
      this.computeETAForTracks();
    } else {
      console.debug('handlePlaylistUpdate - no new list - ignored');
    }
  }


  async ionViewDidEnter() {
    console.debug('begin ionViewDidEnter');

    console.debug('getUser()');
    this.userState = await this.userDataService.getUser();
    if (this.userState.trackFeedback) {
      console.debug('Using trackFeedback from userState', this.userState);
      this.trackFeedback = this.userState.trackFeedback;
    } else {
      console.debug('Using fresh trackFeedback map');
      this.trackFeedback = {};
    }

    console.debug('before refresh()');
    await this.refresh(null);

    // WebSocket:
    if (this.websocketService.isConnected()) {
      console.debug('ionViewDidEnter() - ws is connected');
      this.isConnected = true;
    } else {
      console.debug('ionViewDidEnter() - not connect - init websocket');
      this.websocketService.init(this.currentEvent.eventID, this.userState);
    }

    this.ensureTrackFeedbackEmojis();

    console.debug('end ionViewDidEnter');
  }

  ionViewDidLeave() {
    console.debug('Playlist page leave');
  }

  async ngOnInit() {
    console.debug('Playlist page init');
    this.userState  = await this.userDataService.getUser();
    const eventID = this.userState.currentEventID;


    // Connect websocket
    if (this.websocketService.isConnected()) {
      console.debug('ngOnInit() - ws is already connected');
      this.isConnected = true;
    } else {
      console.debug('ngOnInit() - need to connect ws');
      this.websocketService.init(eventID, this.userState);
    }

    let sub = this.websocketService.observePlaylist().pipe().subscribe(data => {
      console.debug('playlist-page - received playlist update via websocket');
      this.handlePlaylistUpdate(data as Playlist);
    });
    this.subscriptions.push(sub);

    sub = this.websocketService.observeEvent().pipe().subscribe(data => {
      console.debug('playlist-page - received event update');
      this.currentEvent = data as MusicEvent;
      if (this.currentEvent) {
        console.info(`event update: `, this.currentEvent);
        this.checkEverybodyIsCuratorStateChange();
        this.events.publish('event:modified', this.currentEvent);
      } else {
        console.warn('Event has been deleted - navigating to landing page');
        this.router.navigate([`ui/landing`]);
      }
    });
    this.subscriptions.push(sub);

    this.intervalHandle = setInterval(() => {
      this.isConnected = this.websocketService.isConnected();
    }, 1000);
  }

  ngOnDestroy() {
    console.debug('Playlist page destroy');
    this.subscriptions.forEach((sub) => {
      sub.unsubscribe();
    });
    // this.websocketService.disconnect();
    clearInterval(this.intervalHandle);
  }

}


/**
 * Add to playlist modal
 * Search for songs and add to current playlist.
 */
@Component({
  selector: 'app-playlist-add-modal',
  template: `
  <ion-header>
  <ion-toolbar color="dark">
    <ion-buttons slot="start">
      <ion-button (click)="dismiss(null)">
        <ion-icon slot="icon-only" name="close"></ion-icon>
      </ion-button>
    </ion-buttons>
    <ion-title>Add song to playlist</ion-title>
  </ion-toolbar>
  <ion-toolbar color="dark">
    <ion-searchbar id="search" [(ngModel)]="queryText" (ionInput)="updateSearch()" (ionChange)="updateSearch()" placeholder="Search for tracks, albums or artist" #myInput>
    </ion-searchbar>
  </ion-toolbar>
</ion-header>

<ion-content color="light">

  <ion-list color="light">

    <ion-item color="light" *ngFor="let item of tracks">
      <ion-thumbnail slot="start">
        <a href="{{item.image_url_ref}}" target="_blank">
          <img src="{{item.image_url}}">
        </a>
      </ion-thumbnail>
      <ion-label>{{item.name}}<br />
        <span style="font-size: 14px; color: #666;">{{item.artist}}, {{item.year}}, {{item.durationStr}}</span><br />
      </ion-label>

      <a *ngIf="item.preview" href="{{item.preview}}" target="_blank">
        <ion-img float-right src="assets/img/provider/spotify_icon_active_64.png" style="width: 21px; height: 21px; margin-right:10px; margin-left:10px"></ion-img>
      </a>

      <a *ngIf="!item.preview" href="{{item.previewViaApp}}" target="_blank">
        <ion-img float-right src="assets/img/provider/spotify_icon_passive_dark_64.png" style="width: 21px; height: 21px; margin-right:10px; margin-left:10px"></ion-img>
      </a>


      <ion-button id="add-result-{{item.id}}" float-right (click)="dismiss(item)" tappable>Add</ion-button>

      </ion-item>

    </ion-list>

</ion-content>
  `
})
export class PlaylistAddModalComponent implements OnInit {
  currentEvent: MusicEvent;
  queryText = '';
  tracks: Array<Track>;


  @ViewChild(IonSearchbar) myInput: IonSearchbar;

  setFocus() {
    console.debug('Set search focus');
    this.myInput.setFocus();

  }

  constructor(
    public modalController: ModalController,
    public feService: FEService) { }
  dismiss(data) {
    this.modalController.dismiss(data);
  }

  updateSearch() {
    this.feService.searchTracks(this.currentEvent, this.queryText).subscribe(
      data => {
        this.tracks = data;
        for (const track of this.tracks) {
          track.durationStr = new Date(track.duration_ms).toISOString().slice(14, 19);
        }
      },
      err => console.error(err));
  }

  ngOnInit() {
    setTimeout(() => {
      this.setFocus();
    }, 150);
  }
}
