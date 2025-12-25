import { Component, OnInit, Input, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { ModalController, ToastController, AlertController, PopoverController, Platform } from '@ionic/angular';
import { EventsService } from '../../providers/events.service';
import { UserDataService } from '../../providers/user-data.service';
import { MusicEvent } from 'src/app/models/music-event';
import { FEService } from 'src/app/providers/fes.service';
import { UserSessionState } from 'src/app/models/usersessionstate';
import { UntypedFormGroup, UntypedFormBuilder, Validators } from '@angular/forms';
import * as moment from 'moment';
import { UsernameGeneratorService } from 'src/app/providers/username-generator.service';
import { HttpClient } from '@angular/common/http';
import { ConfigService } from 'src/app/providers/config.service';
import { retry, timeout } from 'rxjs/operators';

@Component({
  selector: 'event-login',
  templateUrl: './event-login.page.html',
  styleUrls: ['./event-login.page.scss'],
})
export class EventLoginPage implements OnDestroy, OnInit {

  event: MusicEvent;
  userState: UserSessionState;
  navigationSubscription;
  loginForm: UntypedFormGroup;
//  submitAttempt: boolean;

  static getSessionStateForContext(ctx: string, event: MusicEvent, username: string): UserSessionState {
    const state = new UserSessionState();
    const eventID = event.eventID;
    if (ctx === 'user') {
      state.currentEventID = eventID;
      state.isLoggedIn = true;
      state.username = username;
      state.isCurator = event.everybodyIsCurator;
    }
    if (ctx === 'owner') {
      state.currentEventID = eventID;
      state.isLoggedIn = true;
      state.username = username;
      state.isCurator = true;
      state.isEventOwner = true;
    }
    if (ctx === 'curator') {
      state.currentEventID = eventID;
      state.isLoggedIn = true;
      state.username = username;
      state.isCurator = true;
    }
    state.loginContext = ctx;
    return state;
  }

  static login(component, event: MusicEvent, ctx: string, username: string, password: string) {
    let userState = null;

    if (ctx === 'user') {
      userState = EventLoginPage.getSessionStateForContext(ctx, event, username);
      component.events.publish('sessionState:modified', userState);
      component.router.navigate([`ui/playlist-user`]);
      component.presentToast('You have successfully joined this Event! Start contributing!');
      if (component.dismiss) {
        component.dismiss(null);
      }
    }

    if (ctx === 'owner') {
      if (event.passwordOwner === password && event.owner === username) {
        userState = EventLoginPage.getSessionStateForContext(ctx, event, username);
        component.events.publish('sessionState:modified', userState);
        component.router.navigate(['ui/event-edit']);
        component.presentToast('You have successfully logged in as Event Owner');
        if (component.dismiss) {
          component.dismiss(null);
        }
      } else {
        component.presentToast('Please check your credentials');
      }
    }

    if (ctx === 'curator' ) {
      if (event.passwordCurator === password) {
        userState = EventLoginPage.getSessionStateForContext(ctx, event, username);
        component.events.publish('sessionState:modified', userState);
        component.router.navigate([`ui/playlist-curator`]);
        component.presentToast('You have successfully joined this Event as Curator. Rock it!!');
        if (component.dismiss) {
          component.dismiss(null);
        }
      } else {
        component.presentToast('Please check your credentials');
      }
    }

    return userState;
  }

  static serverSideLogin(user: UserSessionState, event: MusicEvent, confService: ConfigService, platform: Platform, http: HttpClient) {
    if (user) {
      const url = confService.WEB_PROVIDER_API
      + '/events/' + event.eventID + '/user/login';

      const body = {
        userState: user,
        platform: {
          platforms: platform.platforms(),
          width: platform.width(),
          height: platform.height(),
          url: platform.url()
        }

       };

      console.debug('before post url=%s, body=%s', url, JSON.stringify(body));
      http.post(url, body)
          .pipe(
          timeout(confService.SERVER_TIMEOUT),
          retry(1)
          ).subscribe();
    }
  }




  constructor(
    public router: Router,
    private events: EventsService,
    public userDataService: UserDataService,
    public feService: FEService,
    public usergenerator: UsernameGeneratorService,
    private route: ActivatedRoute,
    public modalController: ModalController,
    public toastController: ToastController,
    public alertController: AlertController,
    public popOverCtrl: PopoverController,
    public formBuilder: UntypedFormBuilder,
    public http: HttpClient,
    public confService: ConfigService,
    public platform: Platform
  ) {
    this.navigationSubscription = this.router.events.subscribe((e: any) => {
      if (e instanceof NavigationEnd) {
        console.debug('catching nav end -> init page');
        this.init();
      }
    });
  }

  async presentModal(ctx) {
    const modal = await this.modalController.create({
      component: LoginModalComponent,
      animated: true,
      mode: 'md',
      componentProps: {
        currentEvent: this.event,
        context: ctx
      }
    });

    modal.onDidDismiss().then(res => {
      // if (res.data) {}
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

  async presentMoreOptions(ev: any) {
    console.debug('presentMoreOptions');
    const popover = await this.popOverCtrl.create({
      component: MoreOptionsComponent,
      event: ev,
      translucent: true
    });

    popover.onDidDismiss().then(info => {
      if ( info !== null && info.data) {
        console.debug('onDidDismiss data=%s', info.data);

        switch (info.data) {
          case 'user':
          case 'curator':
          case 'owner':
            this.presentModal(info.data);
            break;

          case 'switch':
            this.switchEvent();
            break;

          case 'landing':
          this.router.navigate(['ui/landing']);
          break;

          default:
            throw new Error('Unexpected data from more options popover dismiss:' + info.data);
        }
      }
    });
    return await popover.present();
  }

  async switchEvent() {
    console.debug('begin switchEvent');

    const popup = await this.alertController.create({
      header: 'Switch Event',
      message: `Please enter the ID of the event.

Look around, it should be advertised at the event location.

Ask your host!`,
      inputs: [
        {
          name: 'eventID',
          type: 'text',
          placeholder: 'demo'
        },
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'secondary',
        }, {
          text: 'Go!',
          handler: (result) => {
            if (result && result.eventID) {
              console.debug('landing: going to event %s', result.eventID);
              this.router.navigate(['ui/event/' + result.eventID.toLowerCase()]);
            }
          }
        }
      ]
    });

    await popup.present();
  }


  serverSideLogout(user: UserSessionState) {
    if (user && this.event && this.event.eventID) {
      const url = this.confService.WEB_PROVIDER_API
      + '/events/' + this.event.eventID + '/user/logout';
      const body = { userState: user };

      console.debug('before post url=%s, body=%s', url, JSON.stringify(body));
      this.http.post(url, body)
          .pipe(
          timeout(this.confService.SERVER_TIMEOUT),
          retry(1)
          ).subscribe();
    }
  }


  formatDate(date) {
    return moment(date).format('DD.MM.YYYY | HH:MM');
  }


  join() {
    console.debug('EventLoginPage#join...');
    if (this.loginForm.valid) {
      if (! this.loginForm.value.username) {
        this.generateUsername();
      }
      const user = EventLoginPage.login(this, this.event, 'user', this.loginForm.value.username, this.loginForm.value.password);
      if (user) {
        EventLoginPage.serverSideLogin(user, this.event, this.confService, this.platform, this.http);
      }
    }
  }


  logout() {
    this.events.publish('user:logout');
    this.serverSideLogout(this.userState);
  }

  clearNavSubscription() {
    if (this.navigationSubscription) {
      this.navigationSubscription.unsubscribe();
    }
  }

  async init() {
    console.debug('begin init');
    this.userState = await this.userDataService.getUser();
    let eventID = this.route.snapshot.paramMap.get('eventId');
    try {
      eventID = eventID.toLowerCase();
      this.event = await this.feService.readEvent(eventID).toPromise();
      console.debug('init event=', this.event);

      // redirect to landing page if event doesn't exist
      if (this.event === null) {
        console.debug('Event not found -> redirect to landing page');
        this.presentToast('SORRY! Event could not be found. Now redirecting to Landing page.');
        this.clearNavSubscription();
        this.router.navigateByUrl('ui/landing');
      }

    } catch (err) {
      console.error('init failed - nav2landing', err);
      this.clearNavSubscription();
      this.router.navigateByUrl('ui/landing');
    }
    console.debug('end init');
  }

  ionViewDidEnter() {
    console.debug('ionViewDidEnter');
  }

  ngOnInit() {
    console.debug('ngOnInit');
    this.loginForm = this.formBuilder.group({
      username: ['', Validators.maxLength(20)],
      password: ['', Validators.nullValidator]
    });
  }

  ngOnDestroy() {
    console.debug('ngOnDestroy');
    this.clearNavSubscription();
  }

  generateUsername() {
    this.loginForm.patchValue({
      username: this.usergenerator.generateUsernameForZoe()
    });
  }
}


/**
 * More Login-Options
 */
@Component({
  selector: 'event-more-options',
  templateUrl: 'more-options-component.html'
})
export class MoreOptionsComponent implements OnInit {

  constructor(
    private router: Router,
    public userDataService: UserDataService,
    public popOverCtrl: PopoverController,
    ) { }

  ngOnInit() {}

  gotoUserLogin() {
    console.debug('more-options#gotoUserLogin');
    this.popOverCtrl.dismiss('user');
  }

  gotoCuratorLogin() {
    console.debug('more-options#gotoCuratorLogin');
    this.popOverCtrl.dismiss('curator');
  }

  gotoEventOwnerLogin() {
    console.debug('more-options#gotoEventOwnerLogin');
    this.popOverCtrl.dismiss('owner');  }

  gotoLanding() {
    console.debug('more-options#gotoLanding');
    this.popOverCtrl.dismiss('landing');
  }

  switchEvent() {
    console.debug('more-options#switchEvent');
    this.popOverCtrl.dismiss('switch');
  }
}


/**
 * Login Modal
 */
@Component({
  selector: 'app-login-modal',
  templateUrl: './login-modal.component.html',
  styleUrls: ['./login-modal.component.scss'],
})
export class LoginModalComponent implements OnInit {


  // Data passed in by componentProps
  @Input() currentEvent: MusicEvent;
  @Input() context: string;

  loginForm: UntypedFormGroup;
  submitAttempt: boolean;



  constructor(
    private modalController: ModalController,
    private feService: FEService,
    private usergenerator: UsernameGeneratorService,
    private formBuilder: UntypedFormBuilder,
    private events: EventsService,
    private router: Router,
    private toastController: ToastController,
    private http: HttpClient,
    private confService: ConfigService,
    private platform: Platform
  ) {
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

  async dismiss(data) {
    await this.modalController.dismiss(data);
    this.resetForm();
  }

  resetForm() {
    this.loginForm.reset();
  }

  generateUsername() {
    this.loginForm.patchValue({
      username: this.usergenerator.generateUsernameForZoe()
    });
  }

  join() {
    console.debug('loginModal#join...');
    if (this.loginForm.valid) {

      const user = EventLoginPage.login(this, this.currentEvent, this.context, this.loginForm.value.username, this.loginForm.value.password);
      if (user) {
        EventLoginPage.serverSideLogin(user, this.currentEvent, this.confService, this.platform, this.http);
      }
    }
  }

  ngOnInit() {
    console.debug('loginModal#ngOnInit');
    this.loginForm = this.formBuilder.group({
      username: ['', Validators.compose([Validators.minLength(3), Validators.maxLength(20), Validators.required])],
      password: ['', Validators.nullValidator]
    });
  }

}
