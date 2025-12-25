import { Component, OnInit, ViewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ToastController, IonContent, AlertController } from '@ionic/angular';
import { EventsService } from '../../providers/events.service';
import { UserDataService } from '../../providers/user-data.service';
import { UntypedFormBuilder, UntypedFormGroup, Validators, FormControl, ValidatorFn, AbstractControl } from '@angular/forms';
import { MusicEvent } from 'src/app/models/music-event';
import { FEService } from 'src/app/providers/fes.service';
import { UserSessionState } from 'src/app/models/usersessionstate';
import { ConfigService } from '../../providers/config.service';

@Component({
  selector: 'app-event-edit',
  templateUrl: './event-edit.page.html',
  styleUrls: ['./event-edit.page.scss'],
})
export class EventEditPage implements OnInit {

  @ViewChild(IonContent) content: IonContent;
  eventForm: UntypedFormGroup;
  event = new MusicEvent();
  userState: UserSessionState;
  submitAttempt: boolean;
  showHelp = true;
  tooltipOptions = {
    placement: 'left',
    hideDelayTouchscreen: 2500,
    hideDelayAfterClick: 2500,
    trigger: 'click',
    'max-width': 300,
    'show-delay': 0
  };
  spotifyPlaylists = [
    {id: '', name: '---none---', numTracks: 0, desc: ''},
  ];
  spotifyDevice = {
    currentDevice: 'none',
    availableDevices: [
      {
        id: 'none',
        desc: 'You need to add your spotify account first'
      }
    ]
  };

  constructor(
    public router: Router,
    private events: EventsService,
    public userDataService: UserDataService,
    public feService: FEService,
    public formBuilder: UntypedFormBuilder,
    public toastController: ToastController,
    public alertController: AlertController,
    public configService: ConfigService,
  ) { }

  private async presentToast(data) {
    const toast = await this.toastController.create({
      message: data,
      position: 'top',
      color: 'light',
      duration: 2000
    });
    toast.present();
  }

  private mapEventToForm(f: UntypedFormGroup, e: MusicEvent) {
    console.debug('begin mapEventToForm');
    f.patchValue(e);

    // ID is only editable upon create:
    if (this.event && this.event.eventID) {
      f.get('eventID').disable();
    } else {
      f.get('eventID').enable();
    }
  }

  public async toggleHelp() {
    if (this.showHelp) {
      this.showHelp = false;
    } else {
      this.showHelp = true;
    }
  }

  public async create({ value, valid }: { value: any, valid: boolean }) {
    console.debug('create');
    console.debug(value);

    if (valid) {
      Object.assign(this.event, value);

      await this.feService.createEvent(this.event).subscribe((event) => {
        console.debug('createEvent -> SUCCESS');
        this.event = event;
        this.mapEventToForm(this.eventForm, this.event);

        this.userState = new UserSessionState();
        this.userState.username = event.owner;
        this.userState.currentEventID = this.event.eventID;
        this.userState.isEventOwner = true;
        this.userState.isCurator = true;
        this.userState.isLoggedIn = true;
        this.events.publish('sessionState:modified', this.userState);
        this.events.publish('event:modified', this.event);
        this.presentToast('You have successfully created this event. You have been also logged in as owner to this event.');
        this.content.scrollToTop();
      },
        (err) => {
          console.error('Calling server side create event...FAILED', err);
          this.presentToast('ERROR creating this event');
        });
    } else {
      console.debug('Form is not valid, ignoring create request');
      this.presentToast('Form is not valid! Please submit all required data.');
    }
  }

  public async update({ value, valid }: { value: any, valid: boolean }) {
    console.debug('update', value);
    if (valid) {
      Object.assign(this.event, value);

      await this.feService.updateEvent(this.event).subscribe((event) => {
        console.debug('updateEvent -> SUCCESS');
        this.event = event;
        this.events.publish('event:modified', this.event);
        this.mapEventToForm(this.eventForm, this.event);
        this.presentToast('You have successfully updated this event.');
        this.content.scrollToTop();
      },
        (err) => {
          console.error('Calling server side update event...FAILED', err);
          this.presentToast('ERROR updating this event');
        });
    } else {
      console.debug('Form is not valid, ignoring update request');
      this.presentToast('Form is not valid! Please submit all required data.');
    }
  }

  public async deleteAlertConfirm() {
    const alert = await this.alertController.create({
      header: 'Delete Event!',
      message: 'Are you sure you want to DELETE this event?',
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
            this.deleteEvent();
          }
        }
      ]
    });
    await alert.present();
  }

  private async deleteEvent() {
    console.debug('deleteEvent');
    await this.feService.deleteEvent(this.event.eventID).subscribe(async (event) => {
      console.debug('deleteEvent -> SUCCESS');
      this.presentToast('You have successfully DELETED this event.');
      this.userState = new UserSessionState();
      this.events.publish('sessionState:modified', this.userState);
      this.events.publish('event:modified', null);
      this.event = await this.feService.readEvent(null).toPromise();
      this.mapEventToForm(this.eventForm, this.event);
      this.content.scrollToTop();
    },
      (err) => {
        this.presentToast('ERROR: Event could not be deleted');
        console.error('Calling server side delete event...FAILED', err);
      });
  }

  public async refreshState() {
    console.debug('refreshState');
    try {
      this.userState = await this.userDataService.getUser();
      // if the user is logged in as user or curator, he should not have access to this page -> redirect to playlist
      if (this.userState.isLoggedIn && !this.userState.isEventOwner) {
        this.router.navigateByUrl('ui/playlist-user');
        return;
      }
      // if user is not logged in -> load new default event.
      if (!this.userState.isLoggedIn) {
        this.event = await this.feService.readEvent(null).toPromise();

        // Highlight mandatory fields by triggering form validation:
        this.eventForm.get('eventID').markAsTouched();
        this.eventForm.get('name').markAsTouched();
        this.eventForm.get('owner').markAsTouched();
      }

      // if the user is the owner, load the event data
      if (this.userState.isLoggedIn && this.userState.isEventOwner) {
        this.event = await this.feService.readEvent(this.userState.currentEventID).toPromise();
        this.events.publish('event:modified', this.event);
      }
      this.ensureTrackFeedbackEmojis();
      this.mapEventToForm(this.eventForm, this.event);
      this.refreshSpotifyPlaylists();
      this.refreshSpotifyDevices();

    } catch (err) {
      console.error('refreshState failed', err);
      this.router.navigateByUrl('ui/landing');
    }
  }

  public async addProviderSpotify() {
    const alert = await this.alertController.create({
      header: 'Add Spotify',
      message: `To add Spotify as music provider for your event, you need:

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
            const href = `${this.configService.SPOTIFY_PROVIDER_API}/events/${this.event.eventID}/providers/spotify/login?user=${this.userState.username}`;
            console.debug('window open', href);

            window.open(href, '_blank');
          }
        }
      ]
    });
    await alert.present();
  }

  public addProviderGoogle() {
    this.presentToast('Sorry, not yet implemented. Google support is coming soon.');
  }
  public addProviderDeezer() {
    this.presentToast('Sorry, not yet implemented. Deezer support is coming soon.');
  }

  public removeProvider(provider) {
    console.debug('begin removeProvider', provider);
    this.feService.deleteProvider(this.event, provider).subscribe(
      result => {
        console.debug('Got new list of providers!');
        this.event.providers = result;
      }
    );
  }

private refreshSpotifyPlaylists() {
  console.debug('refreshSpotifyPlaylists');
  if (this.event && this.event.eventID) {
    this.feService.getSpotifyPlaylists(this.event).subscribe(
      result => {
        console.debug('Got spotify playlists!');
        this.spotifyPlaylists = result;
        this.spotifyPlaylists.unshift({id: '', name: '---none---', numTracks: 0, desc: ''}
        );
      }
    );
  }
}

private refreshSpotifyDevices() {
  console.debug('refreshSpotifyDevices');
  if (this.event && this.event.eventID) {
    this.feService.getSpotifyDevices(this.event).subscribe(
      result => {
        console.debug('Got spotify devices');
        this.spotifyDevice = result;
      }
    );
  }
}

 onSpotifyDeviceChanged(event) {
  console.debug('onSpotifyDeviceChanged');
  const newDevice = event.target.value;
  if (newDevice != this.spotifyDevice.currentDevice) {
    this.feService.setSpotifyDevice(this.event, newDevice).subscribe(
      result => {
        console.debug('onSpotifyDeviceChanged Got spotify devices');
        this.spotifyDevice = result;
      }
    );
  }
}

  async ionViewDidEnter() {
    console.debug('ionViewDidEnter');
    await this.refreshState();

  }

  async ngOnInit() {
    console.debug('ngOnInit');
    this.eventForm = this.formBuilder.group({
      // TODO: add this async validator ->  EventIdValidator
      eventID: [{value: '', disabled: false}, Validators.compose([Validators.minLength(3), Validators.maxLength(12), Validators.pattern('[a-zA-Z0-9]*'), Validators.required]), null],
      name: ['', Validators.compose([Validators.minLength(3), Validators.required])],
      url: [{value: '', disabled: true}],
      maxUsers: [0, Validators.min(1)],
      owner: ['', Validators.compose([Validators.required, Validators.maxLength(20)])],
      passwordOwner: ['', Validators.compose([Validators.minLength(3), Validators.required])],
      // ToDo: Only Required if everybodyIsCurator is false
      passwordCurator: ['', Validators.compose([Validators.minLength(3), Validators.required])],
      passwordUser: [''],
      maxDurationInMinutes: [0, Validators.min(10)],
      maxTracksInPlaylist: [0, Validators.min(0)],
      maxContributionsPerUser: [10],
      eventStartsAt: [new Date().toISOString(), Validators.required],
      eventEndsAt: [{value: '', disabled: true}, Validators.nullValidator],
      allowDuplicateTracks: [false],
      usersCanAddProvider: [true],
      progressPercentageRequiredForEffectivePlaylist: [false],
      beginPlaybackAtEventStart: [false],
      everybodyIsCurator: [false],
      pauseOnPlayError: [false],
      emojiTrackLike: ['🥰', Validators.compose([Validators.minLength(1), Validators.maxLength(2), Validators.required])],
      enableTrackLiking: [false],
      emojiTrackHate: ['🤮', Validators.compose([Validators.minLength(1), Validators.maxLength(2), Validators.required])],
      enableTrackHating: [false],
      enableTrackAI: [false],
      enableTrackAutoMove: [true],
      enableTrackHateSkip: [true],
      enableCurrentTrackHateSkip: [true],
      demoAutoskip: [''],
      demoNoActualPlaying: [false],
      demoAutoFillEmptyPlaylist: [false],
      demoAutoFillFromPlaylist: [''],
      demoAutoFillNumTracks: [0],

      eventViewEnable: [true],
      eventViewPassword: [''],
      eventViewAutoScrollEnable: [false],
      eventViewAutoScrollSpeed: [5, Validators.min(1)],
      eventViewAutoScrollInterval: [10, Validators.min(1)],
      eventViewAutoScrollTopOnNext: [true],
      eventViewShowMetaBars: [true],
      eventViewShowActivityFeed: [true],
      eventViewShowStats: [true],
      eventViewTwitterURL: [''],
      fitTrackWeightBPM: [0.2],
      fitTrackWeightYear: [0.3],
      fitTrackWeightGenre: [0.5],

      autoMoveWeightLike: [1],
      autoMoveWeightHate: [-1],
      skipCurrentTrackQuorum: [3, Validators.min(1)],
      skipCurrentTrackHatePercentage: [66, Validators.compose([Validators.min(0), Validators.max(100)])]
    });
  }

  ensureTrackFeedbackEmojis() {
    if (!this.event.emojiTrackLike) {
      this.event.emojiTrackLike = '🥰';
    }
    if (!this.event.emojiTrackHate) {
      this.event.emojiTrackHate = '🤮';
    }
  }


}
