// popup.js
document.addEventListener("DOMContentLoaded", () => {
  const intro = document.getElementById("intro");
  const recruiterForm = document.getElementById("recruiterForm");
  const candidateForm = document.getElementById("candidateForm");
  const recruiterList = document.getElementById("recruiterList");
  const title = document.getElementById("title");
  let selectedRecruiterEmail = null;

  // Bot animation
  function animateBot() {
    const bot = document.querySelector(".bot-mascot");
    bot.classList.add("animate-bounce");
    setTimeout(() => bot.classList.remove("animate-bounce"), 500);
  }
  title.addEventListener("click", animateBot);

  const showForm = (form) => {
    [intro, recruiterForm, candidateForm].forEach(f => f.classList.add("hidden"));
    form.classList.remove("hidden");
  };

  chrome.storage.sync.get(["userRole"], ({ userRole }) => {
    if (!userRole) showForm(intro);
    else if (userRole === "recruiter") showForm(recruiterForm);
    else if (userRole === "candidate") {
      showForm(candidateForm);
      loadRecruiters();
    }
  });

  document.getElementById("recruiterBtn").addEventListener("click", () => {
    showForm(recruiterForm);
    chrome.storage.sync.set({ userRole: "recruiter" });
  });

  document.getElementById("candidateBtn").addEventListener("click", () => {
    showForm(candidateForm);
    chrome.storage.sync.set({ userRole: "candidate" });
    loadRecruiters();
  });

  document.getElementById("backToIntroFromRec").addEventListener("click", () => {
    showForm(intro);
    chrome.storage.sync.remove("userRole");
  });

  document.getElementById("backToIntroFromCand").addEventListener("click", () => {
    showForm(intro);
    chrome.storage.sync.remove("userRole");
  });

  document.getElementById("syncCalendar").addEventListener("click", () => {
    const name = document.getElementById("recName").value;
    const email = document.getElementById("recEmail").value;
    const company = document.getElementById("recCompany").value;
    const startTime = document.getElementById("recStartTime").value; // e.g., "08:00"
    const endTime = document.getElementById("recEndTime").value;     // e.g., "20:00"
    const status = document.getElementById("recStatus");

    if (!name || !email || !company) return status.textContent = "Please fill all fields";
    if (!startTime || !endTime) return status.textContent = "Please specify start and end times";
    status.textContent = "Syncing calendar...";
    chrome.runtime.sendMessage({ 
      action: "syncRecruiter", 
      name, 
      email, 
      company, 
      startTime, 
      endTime 
    }, (response) => {
      status.textContent = response?.status || "Error: Couldn’t sync";
    });
  });

  document.getElementById("resetRecruiters").addEventListener("click", () => {
    const status = document.getElementById("recStatus");
    if (confirm("Are you sure you want to reset all recruiter data? This cannot be undone.")) {
      status.textContent = "Resetting recruiters...";
      chrome.runtime.sendMessage({ action: "resetRecruiters" }, (response) => {
        status.textContent = response?.status || "Error: Couldn’t reset";
        loadRecruiters();
      });
    }
  });

  function loadRecruiters() {
    chrome.runtime.sendMessage({ action: "getRecruiters" }, (response) => {
      recruiterList.innerHTML = "";
      (response?.recruiters || []).forEach(r => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td class="p-2">${r.name}</td>
          <td class="p-2">${r.company}</td>
          <td class="p-2 text-center">
            <input type="radio" name="recruiter" value="${r.email}" class="focus:ring-green-300">
          </td>
        `;
        row.querySelector("input").addEventListener("change", (e) => {
          selectedRecruiterEmail = e.target.value;
        });
        recruiterList.appendChild(row);
      });
    });
  }

  document.getElementById("submitCand").addEventListener("click", () => {
    const name = document.getElementById("candName").value;
    const email = document.getElementById("candEmail").value;
    const availability = document.getElementById("candAvailability").value;
    const status = document.getElementById("candStatus");

    if (!name || !email || !availability || !selectedRecruiterEmail) {
      return status.textContent = "Please fill all fields and select a recruiter";
    }
    status.textContent = "Scheduling...";
    chrome.runtime.sendMessage({ 
      action: "submitCandidate", 
      name, 
      email, 
      availability, 
      recruiterEmail: selectedRecruiterEmail 
    }, (response) => {
      if (response?.suggestedTime) {
        if (confirm(`Requested time is booked. Suggested: ${response.suggestedTime}. Approve?`)) {
          chrome.runtime.sendMessage({
            action: "confirmCandidate",
            name,
            email,
            recruiterEmail: selectedRecruiterEmail,
            slot: response.slot
          }, (finalResponse) => {
            status.textContent = finalResponse?.status || "Error: Couldn’t schedule";
          });
        } else {
          status.textContent = "Scheduling cancelled. Please try a different time.";
        }
      } else {
        status.textContent = response?.status || "Error: Couldn’t schedule";
      }
    });
  });
});