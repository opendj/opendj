import { UserDataService } from './../../providers/user-data.service';
import { Component, OnInit } from '@angular/core';
import { ModalController, ActionSheetController, ToastController, Platform } from '@ionic/angular';
import { WebsocketService } from 'src/app/providers/websocket.service';
import { MockService } from 'src/app/providers/mock.service';
import { FEService } from './../../providers/fes.service';
import { Track } from 'src/app/models/track';
import { Playlist } from 'src/app/models/playlist';

@Component({
  selector: 'app-playlist',
  templateUrl: 'playlist.page.html',
  styleUrls: ['playlist.page.scss']
})
export class PlaylistPage implements OnInit {
  public selectedItem: any;

  currentPlaylist: Playlist;

  constructor(
    public modalController: ModalController,
    public actionSheetController: ActionSheetController,
    public toastController: ToastController,
    public websocketService: WebsocketService,
    public mockService: MockService,
    public feSevice: FEService,
    public userDataService: UserDataService,
    public platform: Platform
  ) {
  }

  onRenderItems(event) {
    // console.log(`Moving item from ${event.detail.from} to ${event.detail.to}`);
    const draggedItem = this.currentPlaylist.nextTracks.splice(event.detail.from, 1)[0];
    this.currentPlaylist.nextTracks.splice(event.detail.to, 0, draggedItem);
    /*
    this.feSevice.reorderTrack(draggedItem.id, event.detail.from, event.detail.to).subscribe(
      data => {},
      err => console.log(err));
    */
    event.detail.complete();

  }

  async isCurator() {
    return await this.userDataService.getCurator();
  }

  async presentModal() {
    const modal = await this.modalController.create({
      component: PlaylistAddModalComponent,
      componentProps: { value: 123 }
    });
    modal.onDidDismiss().then(res => {
      console.log(res);
      if (res.data) {
        // TODO: send to backend
        this.currentPlaylist.nextTracks.push(res.data);
        this.presentToast('Song added to playlist.');
      }
    });
    return await modal.present();
  }

  async presentToast(data) {
    const toast = await this.toastController.create({
      message: data,
      position: 'bottom',
      color: 'opendj',
      duration: 2000
    });
    toast.present();
  }

  async presentActionSheet(data) {
    const actionSheet = await this.actionSheetController.create({
      header: data,
      buttons: [
        {
          text: 'Play (preview mode)',
          icon: 'arrow-dropright-circle',
          handler: () => {
            console.log('Play clicked');
          }
        }, {
          text: 'Like',
          icon: 'heart',
          handler: () => {
            console.log('Favorite clicked');
            this.presentToast('Your Like has been saved.');
          }
        }, {
          text: 'Share',
          icon: 'share',
          handler: () => {
            console.log('Share clicked');
            this.presentToast('You have shared the song');
          }
        }, {
          text: 'Delete',
          role: 'destructive',
          icon: 'trash',
          handler: () => {
            console.log('Delete clicked');
            this.presentToast('You have deleted the song.');
          }
        }, {
          text: 'Cancel',
          icon: 'close',
          role: 'cancel',
          handler: () => {
            console.log('Cancel clicked');
          }
        }]
    });
    await actionSheet.present();
  }

  trackElement(index: number, element: any) {
    return element ? element.id : null;
  }

  ionViewDidEnter() {
    // console.log(this.websocketService.connect());
  }

  ionViewDidLeave() {
    // console.log(this.websocketService.disconnect());
  }

  async ngOnInit() {
    /*
    this.mockService.getEvents().subscribe(data => {
      this.playlist = data.tracks;
      // console.log(JSON.stringify(this.playlist));
    });
    */
    this.websocketService.getPlaylist().subscribe(data => {
      // console.log(`playlist: ${JSON.stringify(data)}`);
      this.currentPlaylist = data as Playlist;
      console.log(`playlist:`, this.currentPlaylist);
    });
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
    <ion-searchbar [(ngModel)]="queryText" (ionChange)="updateSearch()" placeholder="Search for songs...">
    </ion-searchbar>
  </ion-toolbar>
</ion-header>

<ion-content color="light">

  <ion-list color="light">

    <ion-item color="light" *ngFor="let item of tracks">
      <ion-thumbnail slot="start">
        <img src="{{item.image_url}}">
      </ion-thumbnail>
      <ion-label text-wrap>{{item.name}}<br />
        <span style="font-size: 14px; color: #666;">{{item.artist}}, {{item.year}}</span><br />
      </ion-label>
      <p>
        <ion-button (click)="dismiss(item)">Add</ion-button>
      </p>
    </ion-item>

    </ion-list>

</ion-content>
  `
})
export class PlaylistAddModalComponent implements OnInit {
  queryText = '';
  tracks: Array<Track>;

  constructor(
    public modalController: ModalController,
    public feService: FEService) { }

  dismiss(data) {
    this.modalController.dismiss(data);
  }

  updateSearch() {
    this.feService.searchTracks(this.queryText).subscribe(
      data => {
        this.tracks = data;
      },
      err => console.log(err));
  }

  ngOnInit() {
  }
}
