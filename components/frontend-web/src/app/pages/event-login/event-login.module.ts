import { NgModule } from '@angular/core';
import { SharedModule } from 'src/app/components/shared.module';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { Routes, RouterModule } from '@angular/router';

import { IonicModule } from '@ionic/angular';

import { EventLoginPage, MoreOptionsComponent, LoginModalComponent} from './event-login.page';

const routes: Routes = [
  {
    path: '',
    component: EventLoginPage
  }
];

@NgModule({
    imports: [
        CommonModule,
        ReactiveFormsModule,
        SharedModule,
        IonicModule,
        RouterModule.forChild(routes)
    ],
    declarations: [
        EventLoginPage,
        MoreOptionsComponent,
        LoginModalComponent
    ]
})
export class EventLoginPageModule {}
