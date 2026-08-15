/** Presentation-side backpressure: one comparison target at a time. This does
 * not affect branch stepping; it prevents replacing the equal-tick primary
 * comparison snapshot before the worker can publish its corresponding frame. */
export class CounterfactualTargetGate {
  private inFlight = false;
  canPublish():boolean{return !this.inFlight;}
  markPublished():void{this.inFlight=true;}
  markFrameReceived():void{this.inFlight=false;}
  reset():void{this.inFlight=false;}
}
