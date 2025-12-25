import { AuthGuard } from './providers/auth.guard';
import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [

  { path: '', redirectTo: 'ui/landing', pathMatch: 'full' },
  { path: 'ui/landing', loadChildren: () => import('./pages/landing/landing.module').then(m => m.LandingPageModule), runGuardsAndResolvers: 'always' },
  { path: 'ui/event/:eventId', loadChildren: () => import('./pages/event-login/event-login.module').then(m => m.EventLoginPageModule), runGuardsAndResolvers: 'always'},
  { path: 'ui/event-edit', loadChildren: () => import('./pages/event-edit/event-edit.module').then(m => m.EventEditPageModule), runGuardsAndResolvers: 'always' },
  { path: 'ui/event-view', loadChildren: () => import('./pages/event-view/event-view.module').then(m => m.EventViewPageModule), runGuardsAndResolvers: 'always' },
  { path: 'ui/playlist-user', loadChildren: () => import('./pages/playlist-user/playlist-user.module').then(m => m.PlaylistUserPageModule), runGuardsAndResolvers: 'always' , canActivate: [AuthGuard]},
  { path: 'ui/playlist-curator', loadChildren: () => import('./pages/playlist-curator/playlist-curator.module').then(m => m.PlaylistCuratorPageModule), runGuardsAndResolvers: 'always' , canActivate: [AuthGuard]},
  { path: 'ui/playlist-event', loadChildren: () => import('./pages/playlist-user/playlist-user.module').then(m => m.PlaylistUserPageModule), runGuardsAndResolvers: 'always' , canActivate: [AuthGuard]},
  { path: 'ui/legal', loadChildren: () => import('./pages/legal/legal.module').then(m => m.LegalPageModule), runGuardsAndResolvers: 'always' },
  { path: ':eventID/view', loadChildren: () => import('./pages/event-view/event-view.module').then(m => m.EventViewPageModule), runGuardsAndResolvers: 'always' },
  { path: ':eventID', redirectTo: 'ui/event/:eventID', pathMatch: 'full' },
  { path: '**', redirectTo: 'ui/landing' },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules, onSameUrlNavigation: 'reload' })
  ],
  providers: [],
  exports: [RouterModule]

})
export class AppRoutingModule { }
