import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { SplashScreen } from '@ionic-native/splash-screen/ngx';
import { StatusBar } from '@ionic-native/status-bar/ngx';
import { IonicStorageModule } from '@ionic/storage-angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { MockService } from './providers/mock.service';
import { WebsocketService } from './providers/websocket.service';
import { ConfigService } from './providers/config.service';

@NgModule({ declarations: [AppComponent],
    bootstrap: [AppComponent], imports: [BrowserModule,
        IonicModule.forRoot({ animated: true }),
        IonicStorageModule.forRoot(),
        AppRoutingModule], providers: [
        ConfigService,
        StatusBar,
        SplashScreen,
        MockService,
        WebsocketService,
        {
            provide: APP_INITIALIZER,
            useFactory: (configService: ConfigService) => () => configService.loadConfigurationData(),
            deps: [ConfigService],
            multi: true
        },
        { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
        provideHttpClient(withInterceptorsFromDi())
    ] })
export class AppModule { }
