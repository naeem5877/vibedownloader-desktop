import { Notification, app, shell } from 'electron';
import path from 'path';

export function showNotification(title: string, body: string, iconPath?: string, clickActionPath?: string) {
    if (Notification.isSupported()) {
        const defaultIcon = app.isPackaged
            ? path.join(process.resourcesPath, 'build', 'icon.png')
            : path.join(__dirname, '../../build/icon.png');

        const notification = new Notification({
            title,
            body,
            icon: iconPath || defaultIcon,
            silent: false
        });

        if (clickActionPath) {
            notification.on('click', () => {
                shell.showItemInFolder(clickActionPath);
            });
        }

        notification.show();
    }
}
