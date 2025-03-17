// background.js
console.log("Background script active");

let recruiters = [];
let candidates = [];

async function loadData() {
  const data = await chrome.storage.local.get(["recruiters", "candidates"]);
  recruiters = data.recruiters || [];
  candidates = data.candidates || [];
  // Convert stored ISO strings back to Date objects
  recruiters = recruiters.map(recruiter => ({
    ...recruiter,
    freeSlots: recruiter.freeSlots.map(slot => ({
      start: new Date(slot.start),
      end: new Date(slot.end)
    })),
    bookedSlots: (recruiter.bookedSlots || []).map(slot => ({
      start: new Date(slot.start),
      end: new Date(slot.end)
    }))
  }));
  console.log("Loaded recruiters:", recruiters);
}
loadData();

async function getGoogleAuthToken() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.error("Auth error:", chrome.runtime.lastError.message);
        resolve(null);
      } else if (!token) {
        console.error("No token returned");
        resolve(null);
      } else {
        console.log("Auth token obtained:", token);
        resolve(token);
      }
    });
  });
}

async function getFreeSlots(token, days = 7, startHour = 9, endHour = 17) {
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      items: [{ id: "primary" }],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
  });

  console.log("API Response Status:", response.status, response.statusText);
  const data = await response.json();
  console.log("API Response Data:", data);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} - ${data.error?.message || 'Unknown error'}`);
  }

  if (!data.calendars || !data.calendars.primary) {
    throw new Error("No calendar data returned from API");
  }

  const busy = data.calendars.primary.busy || [];
  const freeSlots = [];
  let current = new Date(startDate);
  while (current < endDate) {
    const nextHour = new Date(current.getTime() + 60 * 60 * 1000);
    const hour = current.getHours();
    if (hour >= startHour && hour < endHour && !busy.some(b => new Date(b.start) < nextHour && new Date(b.end) > current)) {
      freeSlots.push({ start: new Date(current), end: nextHour });
    }
    current = nextHour;
  }
  console.log("Generated free slots:", freeSlots.map(s => s.start.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true })));
  return freeSlots;
}

async function createCalendarEvent(token, candidate, recruiter, slot) {
  const event = {
    summary: `Interview: ${candidate.name} - ${recruiter.company}`,
    start: { dateTime: slot.start.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: slot.end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    attendees: [{ email: candidate.email }, { email: recruiter.email }]
  };
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(event)
  });
  return await response.json();
}

async function parseAvailability(text) {
  try {
    const response = await fetch("http://localhost:5000/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error(`Server responded with ${response.status}`);
    const slots = (await response.json()).slots;
    console.log("Parsed availability:", slots);
    return slots;
  } catch (error) {
    console.error("Failed to parse availability:", error.message);
    return [{ day: "unknown", start: "any", end: "any" }];
  }
}

function matchSlot(candidateSlots, freeSlots, bookedSlots) {
  const normalizeTime = (timeStr) => {
    if (timeStr === "any" || !timeStr) return null;
    const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return null;
    let hour = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;
    if (match[3] === "pm" && hour !== 12) hour += 12;
    if (match[3] === "am" && hour === 12) hour = 0;
    return { hour, minutes };
  };

  for (const slot of candidateSlots) {
    const candDay = slot.day.toLowerCase();
    const candTime = normalizeTime(slot.start);
    const candStartHour = candTime ? candTime.hour : null;
    const candStartMinutes = candTime ? candTime.minutes : 0;

    const exactMatch = freeSlots.find(free => {
      const freeDay = free.start.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const freeHour = free.start.getHours();
      const freeMinutes = free.start.getMinutes();
      const isBooked = bookedSlots.some(b => b.start.getTime() === free.start.getTime());
      return freeDay === candDay && (!candStartHour || (freeHour === candStartHour && freeMinutes === candStartMinutes)) && !isBooked;
    });

    if (exactMatch) {
      return { start: exactMatch.start, end: exactMatch.end };
    }

    const now = new Date();
    const availableSlots = freeSlots
      .filter(free => {
        const freeDay = free.start.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const isBooked = bookedSlots.some(b => b.start.getTime() === free.start.getTime());
        return freeDay === candDay && free.start > now && !isBooked;
      })
      .sort((a, b) => a.start - b.start);

    if (availableSlots.length > 0) {
      const suggestedSlot = availableSlots[0];
      const suggestedTime = suggestedSlot.start.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: true });
      return {
        start: suggestedSlot.start,
        end: suggestedSlot.end,
        suggested: true,
        suggestedTime
      };
    }
  }

  const nextFree = freeSlots.find(free => free.start > new Date() && !bookedSlots.some(b => b.start.getTime() === free.start.getTime()));
  if (nextFree) {
    const suggestedTime = nextFree.start.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: true });
    return { start: nextFree.start, end: nextFree.end, suggested: true, suggestedTime };
  }

  return null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "syncRecruiter") {
    (async () => {
      const token = await getGoogleAuthToken();
      if (!token) {
        sendResponse({ status: "Authentication failed" });
        return;
      }
      try {
        const [startHour, startMin] = request.startTime.split(":").map(Number);
        const [endHour, endMin] = request.endTime.split(":").map(Number);
        const freeSlots = await getFreeSlots(token, 7, startHour, endHour);
        const recruiter = { 
          name: request.name, 
          email: request.email, 
          company: request.company, 
          freeSlots: freeSlots.map(s => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
          bookedSlots: [],
          token,
          startHour,
          endHour
        };
        recruiters.push(recruiter);
        await chrome.storage.local.set({ recruiters });
        sendResponse({ status: `${freeSlots.length} slots synced for ${request.name}` });
      } catch (error) {
        console.error("Sync error:", error.message);
        sendResponse({ status: `Sync failed: ${error.message}` });
      }
    })();
    return true;
  }

  if (request.action === "submitCandidate") {
    (async () => {
      const slots = await parseAvailability(request.availability);
      const candidate = { name: request.name, email: request.email, slots };
      const recruiter = recruiters.find(r => r.email === request.recruiterEmail);
      if (!recruiter) {
        sendResponse({ status: "No matching recruiter" });
        return;
      }
      const freeSlots = recruiter.freeSlots.map(s => ({ start: new Date(s.start), end: new Date(s.end) }));
      const bookedSlots = recruiter.bookedSlots || [];
      const matchedSlot = matchSlot(slots, freeSlots, bookedSlots);

      if (!matchedSlot) {
        sendResponse({ status: "No available slots" });
        return;
      }

      if (matchedSlot.suggested) {
        sendResponse({ 
          suggestedTime: matchedSlot.suggestedTime, 
          slot: { start: matchedSlot.start.toISOString(), end: matchedSlot.end.toISOString() }
        });
      } else {
        await createCalendarEvent(recruiter.token, candidate, recruiter, matchedSlot);
        candidates.push(candidate);
        recruiter.bookedSlots = recruiter.bookedSlots || [];
        recruiter.bookedSlots.push(matchedSlot);
        recruiter.freeSlots = recruiter.freeSlots.filter(s => new Date(s.start).getTime() !== matchedSlot.start.getTime());
        await chrome.storage.local.set({ candidates, recruiters });
        const timeStr = matchedSlot.start.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
        sendResponse({ status: `Scheduled for ${timeStr}, ${matchedSlot.start.toLocaleDateString('en-US')}` });
      }
    })();
    return true;
  }

  if (request.action === "confirmCandidate") {
    (async () => {
      const candidate = { name: request.name, email: request.email };
      const recruiter = recruiters.find(r => r.email === request.recruiterEmail);
      const slot = { start: new Date(request.slot.start), end: new Date(request.slot.end) };
      try {
        await createCalendarEvent(recruiter.token, candidate, recruiter, slot);
        candidates.push(candidate);
        recruiter.bookedSlots = recruiter.bookedSlots || [];
        recruiter.bookedSlots.push(slot);
        recruiter.freeSlots = recruiter.freeSlots.filter(s => new Date(s.start).getTime() !== slot.start.getTime());
        await chrome.storage.local.set({ candidates, recruiters });
        const timeStr = slot.start.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
        sendResponse({ status: `Scheduled for ${timeStr}, ${slot.start.toLocaleDateString('en-US')}` });
      } catch (error) {
        sendResponse({ status: `Scheduling failed: ${error.message}` });
      }
    })();
    return true;
  }

  if (request.action === "getRecruiters") {
    sendResponse({ recruiters: recruiters.map(r => ({ name: r.name, email: r.email, company: r.company })) });
  }

  if (request.action === "resetRecruiters") {
    recruiters = [];
    chrome.storage.local.set({ recruiters }, () => {
      console.log("Recruiters reset");
      sendResponse({ status: "Recruiters reset successfully" });
    });
    return true;
  }
});