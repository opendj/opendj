import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { PlaylistUserPage, PlaylistAddModalComponent } from './playlist-user.page';
import { CurrentTrackComponent } from 'src/app/components/current-track/current-track.component';
import { SharedModule } from 'src/app/components/shared.module';
import { TooltipModule } from 'ng2-tooltip-directive';

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        IonicModule,
        TooltipModule,
        SharedModule,
        RouterModule.forChild([
            {
                path: '',
                component: PlaylistUserPage
            }
        ])
    ],
    declarations: [
        PlaylistUserPage,
        PlaylistAddModalComponent
    ]
})
export class PlaylistUserPageModule { }
