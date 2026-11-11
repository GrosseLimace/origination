/** A Teams channel the signed-in user can post to, from GET /teamschannels/mine. */
export interface GraphTeamsChannel {
  teamId: string;
  teamName: string;
  channelId: string;
  displayName: string;
  /** The channel's "send to channel" address. Needed only to register the channel the first time it
   *  is picked; it is never stored on a note. */
  channelEmail: string;
}
