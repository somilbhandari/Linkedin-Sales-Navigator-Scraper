chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const allowedUrl = "https://www.linkedin.com/sales";

  // Check if the current tab's URL matches the allowed URL
  if (tab.url && tab.url.startsWith(allowedUrl)) {
    // Change the icon to the enabled state
    chrome.action.setIcon({ path: "./images/linkedin_scrapper_128.png", tabId });
    chrome.action.enable(tabId); // Enable the action
  } else {
    // Change the icon to the disabled state
    chrome.action.setIcon({ path: "./images/linkedin_scrapper_16.png", tabId });
    chrome.action.disable(tabId); // Disable the action
  }
});

// Background auto-scraping logic
let autoScrapInterval = null;
let lastScrapedUrl = null;
let lastScrapedCount = 0;
let checkCount = 0;
let lastCheckCount = 0;
let keepAliveInterval = null;

const checkIfAllEntriesLoaded = async (tabId) => {
  try {
    const response = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const loadingSpinner = document.querySelector('.artdeco-loader');
        const showMoreButton = document.querySelector('button.scaffold-finite-scroll__load-button');
        const listItems = document.querySelectorAll(".artdeco-list .artdeco-list__item");
        
        // Check how many entries have actual content loaded
        let entriesWithContent = 0;
        let entriesWithoutContent = 0;
        
        listItems.forEach((item) => {
          // Check for name
          const nameElement = item.querySelector(".artdeco-entity-lockup__title a");
          const name = nameElement ? nameElement.textContent.trim() : '';
          
          // Check for any meaningful data (industry, employees, designation, etc.)
          const hasIndustry = !!item.querySelector(".artdeco-entity-lockup__subtitle span[data-anonymize='industry']")?.textContent?.trim();
          const hasEmployees = !!item.querySelector("a.li-i18n-linkto._view-all-employees_1derdc")?.textContent?.trim();
          const hasDesignation = !!item.querySelector(".artdeco-entity-lockup__subtitle span[data-anonymize='title']")?.textContent?.trim();
          const hasOrganization = !!item.querySelector(".artdeco-entity-lockup__subtitle a[data-anonymize='company-name']")?.textContent?.trim();
          const hasLocation = !!item.querySelector(".artdeco-entity-lockup__caption span[data-anonymize='location']")?.textContent?.trim();
          
          // Entry is "loaded" if it has a name AND at least one other piece of data
          const hasContent = name && (hasIndustry || hasEmployees || hasDesignation || hasOrganization || hasLocation);
          
          if (hasContent) {
            entriesWithContent++;
          } else {
            entriesWithoutContent++;
          }
        });
        
        // Calculate percentage of entries with content
        const contentPercentage = listItems.length > 0 
          ? Math.round((entriesWithContent / listItems.length) * 100) 
          : 0;
        
        console.log("Auto-scrap content check:", {
          url: window.location.href,
          totalEntries: listItems.length,
          entriesWithContent,
          entriesWithoutContent,
          contentPercentage: contentPercentage + '%',
          loadingSpinner: !!loadingSpinner,
          showMoreButton: !!showMoreButton
        });
        
        return {
          isLoading: !!loadingSpinner,
          hasMoreButton: !!showMoreButton,
          currentCount: listItems.length,
          entriesWithContent,
          entriesWithoutContent,
          contentPercentage,
          allEntriesLoaded: contentPercentage >= 95, // 95% threshold to allow for occasional missing data
          url: window.location.href
        };
      },
    });

    return response[0].result;
  } catch (error) {
    console.error("Error checking if entries are loaded", error);
    return { 
      isLoading: true, 
      hasMoreButton: false, 
      currentCount: 0, 
      entriesWithContent: 0,
      entriesWithoutContent: 0,
      contentPercentage: 0,
      allEntriesLoaded: false,
      error: error.message 
    };
  }
};

const performScraping = async (tabId) => {
  try {
    const response = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const listItems = document.querySelectorAll(".artdeco-list .artdeco-list__item");
        const extractedData = Array.from(listItems).map((item) => {
          const addIfExists = (key, value) => value ? { [key]: value.trim() } : {};

          const nameElement = item.querySelector(".artdeco-entity-lockup__title a");
          const name = nameElement ? nameElement.textContent.trim() : null;
          const profileLink = nameElement ? `https://www.linkedin.com${nameElement.getAttribute("href")}` : null;

          const industryElement = item.querySelector(".artdeco-entity-lockup__subtitle span[data-anonymize='industry']");
          const industry = industryElement ? industryElement.textContent.trim() : null;

          const employeesElement = item.querySelector("a.li-i18n-linkto._view-all-employees_1derdc");
          const employees = employeesElement ? employeesElement.textContent.trim() : null;

          const aboutElement = item.querySelector("dd.t-12.t-black--light.mb3 div span:nth-child(2)");
          const about = aboutElement ? aboutElement.textContent.trim().replace("…see more", "").trim() : null;

          const designationElement = item.querySelector(".artdeco-entity-lockup__subtitle span[data-anonymize='title']");
          const designation = designationElement ? designationElement.textContent.trim() : null;

          const organizationElement = item.querySelector(".artdeco-entity-lockup__subtitle a[data-anonymize='company-name']");
          const organization = organizationElement ? organizationElement.textContent.trim() : null;
          const organizationUrl = organizationElement ? `https://www.linkedin.com${organizationElement.getAttribute("href")}` : null;

          const locationElement = item.querySelector(".artdeco-entity-lockup__caption span[data-anonymize='location']");
          const location = locationElement ? locationElement.textContent.trim() : null;

          return {
            ...addIfExists("Name", name),
            ...addIfExists("ProfileURL", profileLink),
            ...addIfExists("Industry", industry),
            ...addIfExists("Employees", employees),
            ...addIfExists("About", about),
            ...addIfExists("Designation", designation),
            ...addIfExists("Organization", organization),
            ...addIfExists("OrganizationURL", organizationUrl),
            ...addIfExists("Location", location),
          };
        });

        return extractedData;
      },
    });

    const newData = response[0].result;
    const result = await chrome.storage.local.get("scrapedListData");
    const existingData = result.scrapedListData || [];
    const combinedData = [...existingData, ...newData];

    await chrome.storage.local.set({ 
      scrapedListData: combinedData,
      lastScrapedCount: combinedData.length 
    });

    return combinedData.length;
  } catch (error) {
    console.error("Error scraping data", error);
    throw error;
  }
};

const runAutoScrap = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return;

  const tabId = tabs[0].id;
  const currentUrl = tabs[0].url;

  try {
    const status = await checkIfAllEntriesLoaded(tabId);
    console.log("=== Background auto-scrap status ===");
    console.log("URL:", currentUrl);
    console.log("Status:", {
      currentCount: status.currentCount,
      entriesWithContent: status.entriesWithContent,
      entriesWithoutContent: status.entriesWithoutContent,
      contentPercentage: status.contentPercentage + '%',
      allEntriesLoaded: status.allEntriesLoaded,
      hasMoreButton: status.hasMoreButton,
      isLoading: status.isLoading
    });
    console.log("lastScrapedUrl:", lastScrapedUrl);
    console.log("lastScrapedCount:", lastScrapedCount);
    
    // Extract page number from URL for comparison
    const getCurrentPage = (url) => {
      if (!url) return null;
      const match = url.match(/[?&]page=(\d+)/);
      return match ? match[1] : '1'; // Default to page 1 if no page param
    };
    
    const currentPage = getCurrentPage(currentUrl);
    const lastPage = getCurrentPage(lastScrapedUrl);
    
    // Check if this is a new page based on page number
    const isNewPage = currentPage !== lastPage;
    
    console.log(`Page comparison: current=${currentPage}, last=${lastPage}, isNewPage=${isNewPage}`);
    
    // If new page detected, reset tracking for this page
    if (isNewPage) {
      console.log("🔄 NEW PAGE DETECTED!");
      console.log("  Current page:", currentPage);
      console.log("  Previous page:", lastPage);
      lastScrapedUrl = currentUrl; // Mark that we've seen this page
      lastScrapedCount = 0;  // Reset count for new page
      checkCount = 0;
      lastCheckCount = status.currentCount; // Start tracking from current count
    }
    
    const hasNewEntries = status.currentCount > lastScrapedCount;
    console.log("isNewPage:", isNewPage, "hasNewEntries:", hasNewEntries, `(${status.currentCount} > ${lastScrapedCount})`);
    console.log("checkCount:", checkCount, "lastCheckCount:", lastCheckCount);
    
    // Track if the count has been stable (no new entries loading)
    if (status.currentCount === lastCheckCount) {
      checkCount++;
    } else {
      checkCount = 0;
      lastCheckCount = status.currentCount;
    }
    
    // Scrape if:
    // 1. No more button (page fully loaded)
    // 2. All entries have content loaded (95%+ have data)
    // 3. Count stable for at least 6 seconds (to avoid race conditions)
    // 4. Has entries
    const countStableForAWhile = checkCount >= 2; // 2 checks * 3 seconds = 6 seconds stable
    const shouldScrape = !status.hasMoreButton && status.allEntriesLoaded && countStableForAWhile && status.currentCount > 0;
    
    console.log("Scrape conditions:", {
      hasMoreButton: status.hasMoreButton,
      allEntriesLoaded: status.allEntriesLoaded,
      countStableForAWhile,
      hasEntries: status.currentCount > 0,
      shouldScrape
    });
    
    console.log("shouldScrape:", shouldScrape);
    
    if (shouldScrape) {
      // Only scrape if it's a new page or has new entries
      const willScrape = isNewPage || hasNewEntries || lastScrapedCount === 0;
      console.log("willScrape:", willScrape);
      
      if (willScrape) {
        console.log("🚀 STARTING SCRAPE...");
        await chrome.storage.local.set({ 
          autoScrapStatus: `Found ${status.currentCount} entries on this page. Scraping...` 
        });
        
        const totalCount = await performScraping(tabId);
        console.log("✅ SCRAPE COMPLETE! Total:", totalCount);
        
        // Update tracking - store URL and count for THIS page
        lastScrapedUrl = currentUrl;
        lastScrapedCount = status.currentCount;
        checkCount = 0;
        
        // Update badge on extension icon
        chrome.action.setBadgeText({ text: String(totalCount) });
        chrome.action.setBadgeBackgroundColor({ color: '#10B981' }); // Green color
        
        await chrome.storage.local.set({ 
          autoScrapStatus: `Page scraped! Total collected: ${totalCount} entries. Navigate to next page to continue.`
        });
      } else {
        console.log("⏭️ Page already scraped, skipping");
        await chrome.storage.local.set({ 
          autoScrapStatus: `This page already scraped (${status.currentCount} entries). Navigate to next page.`
        });
      }
    } else {
      let statusMsg = "";
      if (status.error) {
        statusMsg = `Error: ${status.error}`;
      } else if (status.currentCount === 0) {
        statusMsg = `No entries found. Navigate to Account search page.`;
      } else if (status.isLoading) {
        statusMsg = `Loading page... (${status.currentCount} entries so far)`;
      } else if (status.hasMoreButton) {
        statusMsg = `${status.currentCount} entries visible. Scroll down to load more...`;
      } else if (!status.allEntriesLoaded) {
        statusMsg = `${status.currentCount} entries. Loading data... (${status.contentPercentage}% loaded)`;
      } else if (checkCount < 2) {
        statusMsg = `${status.currentCount} entries ready (${status.contentPercentage}%). Verifying... (${checkCount}/2)`;
      } else {
        statusMsg = `Checking... (${status.currentCount} entries)`;
      }
      await chrome.storage.local.set({ autoScrapStatus: statusMsg });
    }
  } catch (error) {
    console.error("Background auto-scrap error:", error);
    await chrome.storage.local.set({ 
      autoScrapStatus: "Error: " + error.message
    });
  }
};

// Keep service worker alive
const keepAlive = () => {
  console.log("⏰ Keep-alive ping");
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startAutoScrap") {
    console.log("🟢 Starting auto-scrap with keep-alive");
    // Reset tracking when starting
    lastScrapedUrl = null;
    lastScrapedCount = 0;
    checkCount = 0;
    lastCheckCount = 0;
    
    // Set badge to show scraping is active
    chrome.action.setBadgeText({ text: "..." });
    chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' }); // Blue color for "in progress"
    
    // Clear any existing intervals
    if (autoScrapInterval) {
      clearInterval(autoScrapInterval);
    }
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
    }
    
    // Start auto-scraping
    runAutoScrap(); // Run immediately
    autoScrapInterval = setInterval(runAutoScrap, 3000);
    
    // Keep service worker alive by pinging every 20 seconds
    keepAliveInterval = setInterval(keepAlive, 20000);
    
    sendResponse({ success: true });
  } else if (message.action === "stopAutoScrap") {
    console.log("🔴 Stopping auto-scrap and keep-alive");
    if (autoScrapInterval) {
      clearInterval(autoScrapInterval);
      autoScrapInterval = null;
    }
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    lastScrapedUrl = null;
    lastScrapedCount = 0;
    checkCount = 0;
    lastCheckCount = 0;
    
    // Clear badge when stopped
    chrome.action.setBadgeText({ text: "" });
    
    chrome.storage.local.set({ autoScrapStatus: "" });
    sendResponse({ success: true });
  }
  return true;
});
