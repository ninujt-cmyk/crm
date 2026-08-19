export const showLocalNotification = async (title: string, options?: NotificationOptions) => {
  if (!('Notification' in window)) return;
  
  if (Notification.permission === 'granted') {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.showNotification(title, options);
          return;
        }
      }
      new Notification(title, options);
    } catch (error) {
      console.error('Error showing notification:', error);
    }
  }
};