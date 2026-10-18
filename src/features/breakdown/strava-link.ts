/** A Strava profile or activity link (web or app share link). Shared by the form and the API. */
export function stravaLinkOk(link: string): boolean {
  return /^(https?:\/\/)?([a-z0-9-]+\.)?(strava\.com|strava\.app\.link)\/\S+/iu.test(link.trim());
}
