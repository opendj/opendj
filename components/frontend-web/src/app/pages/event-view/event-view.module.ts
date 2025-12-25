import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { EventViewPage } from './event-view.page';
import { CurrentTrackComponent } from 'src/app/components/current-track/current-track.component';
import { SharedModule } from 'src/app/components/shared.module';
import { TooltipModule } from 'ng2-tooltip-directive';

/* remove twitter feed #259
import { NgxTwitterTimelineModule } from 'ngx-twitter-timeline';
*/

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        IonicModule,
        TooltipModule,
        SharedModule,
        //    NgxTwitterTimelineModule,
        RouterModule.forChild([
            {
                path: '',
                component: EventViewPage
            }
        ]),
    ],
    declarations: [
        EventViewPage,
    ]
})
export class EventViewPageModule { }
