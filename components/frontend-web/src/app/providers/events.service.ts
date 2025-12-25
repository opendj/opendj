import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

interface EventData {
  topic: string;
  data: any[];
}

@Injectable({
  providedIn: 'root'
})
export class EventsService {
  private events$ = new Subject<EventData>();

  /**
   * Subscribe to an event topic. Events are published using the publish method.
   * @param topic - The topic to subscribe to
   * @param handler - The event handler
   * @returns A subscription object
   */
  subscribe(topic: string, handler: (...args: any[]) => void): any {
    return this.events$
      .pipe(
        filter(event => event.topic === topic),
        map(event => event.data)
      )
      .subscribe((data: any[]) => {
        handler(...data);
      });
  }

  /**
   * Publish an event to the specified topic
   * @param topic - The topic to publish to
   * @param eventData - The data to publish
   */
  publish(topic: string, ...eventData: any[]): void {
    this.events$.next({
      topic: topic,
      data: eventData
    });
  }

  /**
   * Unsubscribe from the event. If you subscribed using a reference to a handler function,
   * pass that same reference here to unsubscribe.
   * @param subscription - The subscription to unsubscribe
   */
  unsubscribe(subscription: any): void {
    if (subscription && typeof subscription.unsubscribe === 'function') {
      subscription.unsubscribe();
    }
  }
}
