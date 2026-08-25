const VIMEO_VIDEO_URL = 'https://player.vimeo.com/video/1218568946';

export function VideoTutorial() {
    return (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black relative">
            <iframe
                src={`${VIMEO_VIDEO_URL}?badge=0&autopause=0&player_id=0&app_id=58479&autoplay=1&muted=1&loop=1`}
                title="Introducing the VibeDownloader extension"
                allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                className="w-full aspect-video"
            />
        </div>
    );
}
