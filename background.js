console.log("Background script active");

let recruiters = [];
let candidates = [];

async function loadData() {
  const data = await chrome.storage.local.get(["recruiters", "candidates"]);
  recruiters = data.recruiters || [];
  candidates = data.candidates || [];
  console.log("Loaded recruiters:", recruiters);
}
loadData();

async function getGoogleAuthToken() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error("Auth error:", chrome.runtime.lastError?.message);
        resolve(null);
      } else {
        resolve(token);
      }
    });
  });
}

async function getFreeSlots(token, days = 7) {
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0); // Start at midnight local time
  const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      items: [{ id: "primary" }],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone // Use local timezone
    })
  });
  const data = await response.json();
  const busy = data.calendars.primary.busy || [];
  const freeSlots = [];
  let current = new Date(startDate);
  while (current < endDate) {
    const nextHour = new Date(current.getTime() + 60 * 60 * 1000);
    const hour = current.getHours();
    if (hour >= 9 && hour < 17 && !busy.some(b => new Date(b.start) < nextHour && new Date(b.end) > current)) {
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
    return [{ day: "unknown", "start": "any", "end": "any" }];
  }
}

function matchSlot(candidateSlots, freeSlots) {
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

  console.log("Candidate slots:", candidateSlots);
  console.log("Free slots:", freeSlots.map(s => s.start.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true })));

  for (const slot of candidateSlots) {
    const candDay = slot.day.toLowerCase();
    const candTime = normalizeTime(slot.start);
    const candStartHour = candTime ? candTime.hour : null;
    const candStartMinutes = candTime ? candTime.minutes : 0;

    // Exact match
    const exactMatch = freeSlots.find(free => {
      const freeDay = free.start.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const freeHour = free.start.getHours();
      const freeMinutes = free.start.getMinutes();
      return freeDay === candDay && (!candStartHour || (freeHour === candStartHour && freeMinutes === candStartMinutes));
    });
    if (exactMatch) {
      console.log("Exact match found:", exactMatch.start.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }));
      return { start: exactMatch.start, end: exactMatch.end };
    }

    // Closest slot on same day
    const now = new Date();
    const sameDaySlots = freeSlots
      .filter(free => {
        const freeDay = free.start.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        return freeDay === candDay && free.start > now;
      })
      .sort((a, b) => {
        const aDiff = Math.abs(a.start.getHours() * 60 + a.start.getMinutes() - ((candStartHour || 12) * 60 + candStartMinutes));
        const bDiff = Math.abs(b.start.getHours() * 60 + b.start.getMinutes() - ((candStartHour || 12) * 60 + candStartMinutes));
        return aDiff - bDiff;
      });

    if (sameDaySlots.length > 0) {
      const closestSlot = sameDaySlots[0];
      console.log("Closest slot on same day:", closestSlot.start.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }));
      return {
        start: closestSlot.start,
        end: closestSlot.end,
        suggested: true,
        requested: `${candDay} ${candStartHour !== null ? `${candStartHour}:${candStartMinutes.toString().padStart(2, '0')} ${candStartHour >= 12 ? 'PM' : 'AM'}` : 'any time'}`
      };
    }

    // Next available slot
    const nextSlot = freeSlots.find(free => free.start > now && free.start.getHours() >= 9);
    if (nextSlot) {
      console.log("Next available slot:", nextSlot.start.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }));
      return {
        start: nextSlot.start,
        end: nextSlot.end,
        suggested: true,
        requested: `${candDay} ${candStartHour !== null ? `${candStartHour}:${candStartMinutes.toString().padStart(2, '0')} ${candStartHour >= 12 ? 'PM' : 'AM'}` : 'any time'}`
      };
    }
  }

  const fallback = freeSlots.find(free => free.start > new Date()) || freeSlots[0];
  console.log("Fallback slot:", fallback?.start.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }));
  return fallback 
    ? { start: fallback.start, end: fallback.end, suggested: true, requested: candidateSlots[0]?.day || "unknown" }
    : { start: new Date(), end: new Date(Date.now() + 60 * 60 * 1000), suggested: true };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "syncRecruiter") {
    getGoogleAuthToken().then(async (token) => {
      if (!token) {
        sendResponse({ status: "Authentication failed" });
        return;
      }
      try {
        const freeSlots = await getFreeSlots(token);
        const recruiter = { 
          name: request.name, 
          email: request.email, 
          company: request.company, 
          freeSlots: freeSlots.map(s => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
          token 
        };
        recruiters.push(recruiter);
        await chrome.storage.local.set({ recruiters });
        sendResponse({ status: `${freeSlots.length} slots synced for ${request.name}` });
      } catch (error) {
        sendResponse({ status: `Sync failed: ${error.message}` });
      }
    });
    return true;
  }

  if (request.action === "submitCandidate") {
    parseAvailability(request.availability).then(async (slots) => {
      const candidate = { name: request.name, email: request.email, slots };
      const recruiter = recruiters.find(r => r.email === request.recruiterEmail);
      if (!recruiter) {
        sendResponse({ status: "No matching recruiter" });
        return;
      }
      const freeSlots = recruiter.freeSlots.map(s => ({ start: new Date(s.start), end: new Date(s.end) }));
      const matchedSlot = matchSlot(slots, freeSlots);
      try {
        await createCalendarEvent(recruiter.token, candidate, recruiter, matchedSlot);
        candidates.push(candidate);
        recruiter.freeSlots = recruiter.freeSlots.filter(s => new Date(s.start).getTime() !== matchedSlot.start.getTime());
        await chrome.storage.local.set({ candidates, recruiters });
        const timeFormat = { hour: 'numeric', minute: 'numeric', hour12: true };
        const msg = matchedSlot.suggested 
          ? `Requested ${matchedSlot.requested} unavailable. Scheduled for ${matchedSlot.start.toLocaleString('en-US', timeFormat)}, ${matchedSlot.start.toLocaleDateString('en-US')}`
          : `Scheduled for ${matchedSlot.start.toLocaleString('en-US', timeFormat)}, ${matchedSlot.start.toLocaleDateString('en-US')}`;
        sendResponse({ status: msg });
      } catch (error) {
        sendResponse({ status: `Scheduling failed: ${error.message}` });
      }
    }).catch(error => {
      sendResponse({ status: `Parsing failed: ${error.message}` });
    });
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