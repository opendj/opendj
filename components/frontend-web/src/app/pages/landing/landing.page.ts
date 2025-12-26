import { Component, OnInit, ViewChild, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, MenuController } from '@ionic/angular';
import Swiper from 'swiper';

@Component({
  selector: 'landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
})
export class LandingPage implements OnInit {

  @ViewChild('swiper') swiperRef: any;
  swiper?: Swiper;
  showSkip = false;

  constructor(
    private router: Router,
    private alertController: AlertController,
  ) { }

  createOwnEvent() {
    this.router.navigate([`ui/event-edit`]);
  }

  skip() {
    this.swiper?.slideTo(0);
  }

  async joinExistingEvent() {
    console.debug('begin joinExistingEvent');

    const popup = await this.alertController.create({
      header: 'Join Existing Event',
      message: `Please enter the ID of the event.

Look around, it should be advertised at the event location.

Ask your host!`,
      inputs: [
        {
          id: 'eventID',
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
// DAN: I think this is a bug that a button cant have and ID like an input:
//          id: 'Go',
          cssClass: 'idForSelenium_Go',

          handler: (result) => {
            let target = 'demo';
            if (result && result.eventID) {
              target = result.eventID.toLowerCase();
            }
            console.debug('landing: going to event %s', target);
            this.router.navigate(['ui/event/' + target]);
          }
        }
      ]
    });


    console.debug('before  present');
    popup.present();
    console.debug('end joinExistingEvent');

  }

  handleSlideChange() {
    // console.log('Slide change');
    const value = this.swiper?.activeIndex || 0;
    // console.log(value);
    if (value !== 0) {
      this.showSkip = true;
    } else {
      this.showSkip = false;
    }
  }

  ngOnInit() {
  }

  ngAfterViewInit() {
    // Initialize Swiper
    setTimeout(() => {
      const swiperEl = this.swiperRef?.nativeElement;
      if (swiperEl) {
        // Set Swiper parameters
        Object.assign(swiperEl, {
          slidesPerView: 1,
          spaceBetween: 0,
          pagination: {
            clickable: true,
          },
          // Enable touch/swipe
          touchRatio: 1,
          touchAngle: 45,
          grabCursor: true,
          // Enable keyboard control
          keyboard: {
            enabled: true,
          },
        });

        // Initialize Swiper
        swiperEl.initialize();
        this.swiper = swiperEl.swiper;
      }
    }, 100);
  }

}
