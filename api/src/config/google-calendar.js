const { google } = require('googleapis');
const path = require('path');

let authClient = null;

function getAuthClient() {
  if (!authClient) {
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    if (!keyPath) {
      console.warn('Google Calendar credentials not configured');
      return null;
    }

    authClient = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
  }

  return authClient;
}

async function createCalendarEvent(summary, description, startTime, endTime) {
  try {
    const auth = getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });

    const event = {
      summary,
      description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'America/Sao_Paulo',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'America/Sao_Paulo',
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    return response.data;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw error;
  }
}

module.exports = {
  createCalendarEvent,
};

