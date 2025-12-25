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
  templateUrl: 'playlist-curator.page.html',
  styleUrls: ['playlist-curator.page.scss']
})
export class PlaylistCuratorPage implements OnInit, OnDestroy {
  public selectedItem: any;

  currentEvent: MusicEvent = null;
  currentPlaylist: Playlist = null;
  subscriptions: Subscription[] = [];
  userState: UserSessionState;
  isCurator = false;
  showOptions = false;
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

  constructor(
    public modalController: ModalController,
    public actionSheetController: ActionSheetController,
    public toastController: ToastController,
    private events: EventsService,
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

  deleteTrack(track, index) {
    console.debug('deleteTrack');
    this.feService.deleteTrack(this.currentEvent, track.id, index, this.userState).subscribe(
      res => {
        this.handlePlaylistUpdate(res);
        this.presentToast('You have deleted the track.');
      },
      err => console.error(err)
    );
  }


  normalizeBPM(bpm: number): number {
    // Map 100 - 200 BPM to value 0.0 -> 1.0
    return (bpm - 100.0) / (200.0 - 100.0);
  }

  normalizeYear(year: number): number {
    // Map 1970 - 2020 to value 0.0 -> 1.0
    return (year - 1970) / (2020.0 - 1970.0);
  }

  square(val: number) {
    return Math.pow(val, 2);
  }

  calcDistanceOfTracks(t1: Track, t2: Track) {
    // Euclidian distance based on dimensions bpm, year, genre.
    // values are normalize to values from 0.0 -> 1.0.
    // each dimension has a weight;
    const bpm1 = this.normalizeBPM(t1.bpm);
    const bpm2 = this.normalizeBPM(t2.bpm);
    const year1 = this.normalizeYear(t1.year);
    const year2 = this.normalizeYear(t2.year);
    const genre1 = t1.genreMap;
    const genre2 = t2.genreMap;
    // TODO: #195 Make Weight configurable at event (advanced options)
    const weightBPM   = this.currentEvent.fitTrackWeightBPM;
    const weightYear  = this.currentEvent.fitTrackWeightYear;
    const weightGenre = this.currentEvent.fitTrackWeightGenre;

    return Math.sqrt(
      weightBPM * this.square(bpm2 - bpm1)
    + weightYear * this.square(year2 - year1)
    + weightGenre * this.square(genre2.x - genre1.x)
    + weightGenre * this.square(genre2.y - genre1.y)
    );
  }


  fitTrack(selectedTrack: Track, currentPos: number) {
    console.debug('begin fitTrack currentPos=%s, track=%s', currentPos, selectedTrack.name);
    const playlist = this.currentPlaylist;

    if (playlist.nextTracks) {
      let minDistance = Number.MAX_VALUE;
      let targetPos = -1;
      let targetTrack = null;
      let message = '';
      let insertBefore = false;

      // Iterate over list of next tracks and find the track with the
      // minimum distance to the current track;
      // tslint:disable-next-line:prefer-for-of
      for (let i = 0; i < playlist.nextTracks.length; i++) {

        if (i === currentPos) {
          // The distance to the same track is 0, thus we skip this track:
          continue;
        }

        const currentTrack = playlist.nextTracks[i];
        const distance = this.calcDistanceOfTracks(currentTrack, selectedTrack);
        console.debug('distance=%s to pos=%s /track=%s', distance, i, currentTrack.name);
        if (distance < minDistance) {
          minDistance = distance;
          targetPos = i;
          targetTrack = currentTrack;
        }
      }

      // Check Distance to currently playing track:
      if (playlist.currentTrack) {
        console.debug('check distance to currently playing track');
        const distance = this.calcDistanceOfTracks(playlist.currentTrack, selectedTrack);
        if (distance < minDistance) {
          console.debug('new minDistance=%s', distance);
          minDistance = distance;
          targetPos = 0;
          targetTrack = playlist.currentTrack;
          insertBefore = true;
        }
      }

      if (targetPos === -1) {
        message = 'No good fit found';
      } else {
        console.debug('Track to which selected track has minimum distance %s at pos=%s track=%s, insertBefore=%s', minDistance, targetPos, playlist.nextTracks[targetPos].name, insertBefore);

        if (!insertBefore) {
          // We want to insert AFTER that track, thus we need to increment by one (pos 0 means TOP of list,
          // and server side move always inserts BEFORE):
          targetPos++;
        }


        // Now we have to avoid breaking existing "trains" of tracks, i.e. where there is already a small distance between two tracks.
        // (the distance to the track to be inserted could be greater)
        // Thus, we search from here below to find a position where the distance is smaller then the su:
        for (let i = targetPos; i < playlist.nextTracks.length; i++) {
          if ( i === currentPos) {
            console.debug('The selected track is already in the train after the best fit track, thus, it is better not to move it');
            targetPos = currentPos;
            break;
          }

          const distance = this.calcDistanceOfTracks(targetTrack, playlist.nextTracks[i]);
          console.debug('distance=%s to pos %d', distance, i);
          if (distance > minDistance) {
            //  Distance target->successor is greater then distance target->selected track,
            // thus we should insert selected track before that successor :
            targetPos = i;
            break;
          }
        }
        console.debug('New targetPos after train check: %d', targetPos);

        if (targetPos === currentPos) {
          message = 'Not moved - already at best fitting position';
        } else {
          message = 'Moved to best fitting position ' + targetPos;
          this.moveTrack(currentPos, targetPos);
        }
      }
      this.presentToast(message);
    }
    console.debug('end fitTrack');
  }

  selectTrack(track, index) {
    console.debug('fitTrack');
    this.presentToast('Sorry, track selection is not yet implemented');
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

  isTrackSelected(trackID) {
    return 'false';
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


  date2hhmm(d) {
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
        const track = playlist.nextTracks[i];
        track.eta = this.date2hhmm(new Date(ts));
        track.pos = i;

        ts += track.duration_ms;

        track.durationStr = new Date(track.duration_ms).toISOString().slice(14, 19);
      }
    }
  }

  moveTrack(fromPos: number, toPos: number) {
    console.debug('moveTrack from=%s to=%s', fromPos, toPos);

    const track = this.currentPlaylist.nextTracks[fromPos];
    console.debug('moveTrack t=%s', track.name);

    // Remove at current Pos:
//    this.currentPlaylist.nextTracks.splice(fromPos, 1);

    // Insert at new Pos:
//    this.currentPlaylist.nextTracks.splice(fromPos < toPos ? toPos - 1 : toPos, 0, track);
//    this.currentPlaylist.nextTracks.splice(toPos, 0, track);

    this.feService.reorderTrack(this.currentEvent, track.id, fromPos, toPos, this.userState).subscribe(
      data => {
        this.handlePlaylistUpdate(data);
        this.presentToast('Track successfully moved to pos ' + toPos);
      },
      err => console.log(err)
    );
  }

  handleTrackReorderEvent(event) {
    console.debug('handleTrackReorderEvent %s', JSON.stringify(event.detail));
    const from = event.detail.from;
    const to = event.detail.to;
    this.moveTrack(from, from < to ? to + 1 : to);
    event.detail.complete();
  }

  toggleOptions() {
    if (this.showOptions) {
      this.showOptions = false;
    } else {
      this.showOptions = true;
    }
  }

  moveTop(item, index) {
    console.log('------MOVE TOP TEST------');
    if (this.isCurator) {
      this.feService.reorderTrack(this.currentEvent, item.id, index, 0, this.userState).subscribe(
        data => {
          this.handlePlaylistUpdate(data);
          this.presentToast('Track moved to top.');
        },
        err => console.error(err)
      );
    }
  }

  noPreview() {
    this.presentToast('Sorry, Spotify does not provide a preview for this track.');
  }

  async searchAndAddTrack() {
    if (this.getAddTrackButtonColor() === 'danger') {
      this.presentToast('Sorry, this playlist has reached max size. Please try later');
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

  async presentActionSheet(data, index) {
    const actionSheet = await this.actionSheetController.create({
      header: data.title,
      buttons: [
        {
          text: 'Play (preview mode)',
          icon: 'arrow-dropright-circle',
          handler: () => {
            console.log('Play clicked');
          }
        },
        {
          text: 'Delete',
          role: 'destructive',
          icon: 'trash',
          handler: () => {
            console.debug('Delete clicked');
            this.feService.deleteTrack(this.currentEvent, data.id, index, this.userState).subscribe(
              res => {
                console.debug(res);
                this.presentToast('You have deleted the track.');
              },
              err => console.log(err)
            );
          }
        }, {
          text: 'Cancel',
          icon: 'close',
          role: 'cancel',
          handler: () => {
            console.debug('Cancel clicked');
          }
        }]
    });
    if (this.isCurator) {
      await actionSheet.present();
    }

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

        if (!newCuratorState) {
          this.presentToast('Sorry, you are no longer curator of this event - bringing you back to playlist page.');
          this.router.navigate([`ui/playlist-user`]);
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
    this.currentPlaylist = newPlaylist;
    this.computeETAForTracks();
  }


  async ionViewDidEnter() {
    console.debug('begin ionViewDidEnter');

    console.debug('getUser()');
    this.userState = await this.userDataService.getUser();
    this.isCurator = this.userState.isCurator;

    console.debug('before refresh()');
    await this.refresh(null);

    if (this.websocketService.isConnected()) {
      console.debug('ionViewDidEnter() - ws is already connected');
      this.isConnected = true;
    } else {
      console.debug('ionViewDidEnter() - need to connect ws');
      this.websocketService.init(this.currentEvent.eventID, this.userState);
    }

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
      this.handlePlaylistUpdate(data);
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
//    this.websocketService.disconnect();
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
    <ion-searchbar id="search" [(ngModel)]="queryText" (ionChange)="updateSearch()" placeholder="Search for tracks, albums or artist" #myInput>
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
