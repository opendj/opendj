import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { UserDataService } from './user-data.service';

@Injectable({
    providedIn: 'root',
})
export class AuthGuard  {

    constructor(private userDataService: UserDataService, private router: Router) { }

    canActivate(
        next: ActivatedRouteSnapshot,
        state: RouterStateSnapshot): boolean {

        const url: string = state.url;
        console.debug('canActivate -> state.url=%s', url);
        return this.checkLoginStatus(url);
    }

    checkLoginStatus(url: string): any {
        const urlString = url;
        return this.userDataService.getUser().then(user => {
            let result = false;
            if (!user.isLoggedIn) {
                console.debug('checkLoginStatus -> user is not logged in, redirect to landing');
                this.router.navigateByUrl('ui/landing');
                result = false;
            } else {
                console.debug('checkLoginStatus -> user is logged in');
                result = true;
            }
            return result;
        });

    }
}
