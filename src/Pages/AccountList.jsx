/* eslint-disable no-undef */
import { useState, useEffect, useRef } from "react";
import { IoArrowDownCircleSharp, IoWarning } from "react-icons/io5";
import Papa from "papaparse";

const AccountList = () => {
  const [csvData, setCsvData] = useState("");
  const [tableSheetCount, setTableSheetCount] = useState(0);
  const [autoScrap, setAutoScrap] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const hasScrapedRef = useRef(false);
  const intervalRef = useRef(null);

  // Load persisted state on mount
  useEffect(() => {
    chrome.storage.local.get(["autoScrapEnabled", "scrapedListData", "autoScrapStatus"], (result) => {
      if (result.autoScrapEnabled !== undefined) {
        setAutoScrap(result.autoScrapEnabled);
      }
      if (result.autoScrapStatus) {
        setStatusMessage(result.autoScrapStatus);
      }
      if (result.scrapedListData) {
        const existingData = result.scrapedListData;
        const csv = (() => {
          const nonEmptyColumns = [
            "Name",
            "ProfileURL",
            "Location",
            "Industry",
            "Employees",
            "Designation",
            "Organization",
            "OrganizationURL",
            "About",
          ].filter((column) =>
            existingData.some(
              (row) => row[column] && row[column].trim() !== ""
            )
          );
          return Papa.unparse(existingData, {
            columns: nonEmptyColumns,
          });
        })();
        setCsvData(csv);
        setTableSheetCount(existingData.length);
        if (existingData.length > 0) {
          hasScrapedRef.current = true;
        }
      }
    });

    // Poll for status updates from background script
    const statusInterval = setInterval(() => {
      chrome.storage.local.get(["autoScrapStatus", "scrapedListData", "autoScrapEnabled", "lastScrapedCount"], (result) => {
        if (result.autoScrapStatus) {
          setStatusMessage(result.autoScrapStatus);
        }
        if (result.autoScrapEnabled !== undefined) {
          setAutoScrap(result.autoScrapEnabled);
        }
        if (result.scrapedListData && result.scrapedListData.length > 0) {
          const existingData = result.scrapedListData;
          const csv = (() => {
            const nonEmptyColumns = [
              "Name",
              "ProfileURL",
              "Location",
              "Industry",
              "Employees",
              "Designation",
              "Organization",
              "OrganizationURL",
              "About",
            ].filter((column) =>
              existingData.some(
                (row) => row[column] && row[column].trim() !== ""
              )
            );
            return Papa.unparse(existingData, {
              columns: nonEmptyColumns,
            });
          })();
          setCsvData(csv);
          setTableSheetCount(existingData.length);
          if (existingData.length > 0) {
            hasScrapedRef.current = true;
          }
        } else {
          // No data in storage
          if (!result.scrapedListData || result.scrapedListData.length === 0) {
            setCsvData("");
            setTableSheetCount(0);
          }
        }
      });
    }, 500); // Poll every 500ms for status updates

    return () => clearInterval(statusInterval);
  }, []);

  const fetchListData = async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      const response = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Select all list items
          const listItems = document.querySelectorAll(
            ".artdeco-list .artdeco-list__item"
          );
          const extractedData = Array.from(listItems).map((item) => {
            // Helper function to add only valid fields
            const addIfExists = (key, value) =>
              value ? { [key]: value.trim() } : {};

            // Extract data from the list item
            const nameElement = item.querySelector(
              ".artdeco-entity-lockup__title a"
            );
            const name = nameElement ? nameElement.textContent.trim() : null;

            const profileLink = nameElement
              ? `https://www.linkedin.com${nameElement.getAttribute("href")}`
              : null;

            const industryElement = item.querySelector(
              ".artdeco-entity-lockup__subtitle span[data-anonymize='industry']"
            );
            const industry = industryElement
              ? industryElement.textContent.trim()
              : null;

            const employeesElement = item.querySelector(
              "a.li-i18n-linkto._view-all-employees_1derdc"
            );
            const employees = employeesElement
              ? employeesElement.textContent.trim()
              : null;

            const aboutElement = item.querySelector(
              "dd.t-12.t-black--light.mb3 div span:nth-child(2)"
            );
            const about = aboutElement
              ? aboutElement.textContent.trim().replace("…see more", "").trim()
              : null;

            const designationElement = item.querySelector(
              ".artdeco-entity-lockup__subtitle span[data-anonymize='title']"
            );
            const designation = designationElement
              ? designationElement.textContent.trim()
              : null;

            const organizationElement = item.querySelector(
              ".artdeco-entity-lockup__subtitle a[data-anonymize='company-name']"
            );
            const organization = organizationElement
              ? organizationElement.textContent.trim()
              : null;

            const organizationUrl = organizationElement
              ? `https://www.linkedin.com${organizationElement.getAttribute(
                  "href"
                )}`
              : null;

            const locationElement = item.querySelector(
              ".artdeco-entity-lockup__caption span[data-anonymize='location']"
            );
            const location = locationElement
              ? locationElement.textContent.trim()
              : null;

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
      chrome.storage.local.get("scrapedListData", (result) => {
        const existingData = result.scrapedListData || [];
        const combinedData = [...existingData, ...newData]; // Combine old and new data

        // Save the combined data back to storage
        chrome.storage.local.set({ scrapedListData: combinedData }, () => {
          const csv = (() => {
            // Extract all the keys from `combinedData` and check which columns are not empty
            const nonEmptyColumns = [
              "Name",
              "ProfileURL",
              "Location",
              "Industry",
              "Employees",
              "Designation",
              "Organization",
              "OrganizationURL",
              "About",
            ].filter((column) =>
              combinedData.some(
                (row) => row[column] && row[column].trim() !== ""
              )
            );

            // Generate CSV only for the non-empty columns
            return Papa.unparse(combinedData, {
              columns: nonEmptyColumns,
            });
          })();
          setCsvData(csv);
          setTableSheetCount(combinedData.length);
          hasScrapedRef.current = true;
        });
      });
    } catch (error) {
      console.error("Error scraping list data", error);
    }
  };

  // Auto-scrap effect - now handled by background script
  // This useEffect is intentionally removed to prevent unwanted stop messages
  // The toggle button handler now directly controls start/stop

  const handleAutoScrapToggle = () => {
    const newAutoScrapValue = !autoScrap;
    
    if (newAutoScrapValue) {
      // Turning ON
      hasScrapedRef.current = false;
      setStatusMessage("Starting auto-scrap...");
      setAutoScrap(newAutoScrapValue);
      chrome.storage.local.set({ autoScrapEnabled: newAutoScrapValue });
      
      // Send message to background script to start auto-scraping
      chrome.runtime.sendMessage({ action: "startAutoScrap" }, (response) => {
        if (response && response.success) {
          console.log("Background auto-scrap started");
        }
      });
    } else {
      // Turning OFF
      setStatusMessage("");
      setAutoScrap(newAutoScrapValue);
      chrome.storage.local.set({ autoScrapEnabled: newAutoScrapValue });
      
      // Send message to background script to stop auto-scraping
      chrome.runtime.sendMessage({ action: "stopAutoScrap" }, (response) => {
        if (response && response.success) {
          console.log("Background auto-scrap stopped");
        }
      });
    }
  };

  const downloadCsv = () => {
    if (!csvData) {
      console.error("No CSV data available for download");
      return;
    }

    const blob = new Blob([csvData], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "linkedin_data.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    clearData();
  };

  const clearData = () => {
    chrome.storage.local.remove(["scrapedListData", "autoScrapEnabled", "autoScrapStatus"], () => {
      setCsvData("");
      setTableSheetCount(0);
      hasScrapedRef.current = false;
      setAutoScrap(false);
      setStatusMessage("");
      
      // Clear badge on extension icon
      chrome.action.setBadgeText({ text: "" });
      
      console.log("Scraped data cleared.");
    });
  };

  return (
    <div className="p-2 space-y-3">
      {/* Auto Scrap Toggle */}
      <div className="p-2 bg-blue-50 rounded-lg space-y-2">
        <div className="flex items-center justify-center gap-3">
          <label className="text-sm font-medium text-gray-700">Auto scrap</label>
          <button
            onClick={handleAutoScrapToggle}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoScrap ? "bg-green-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoScrap ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        {statusMessage && autoScrap && (
          <div className="text-xs text-center text-blue-700 bg-blue-100 p-2 rounded">
            {statusMessage}
          </div>
        )}
      </div>

      <h1 className="text-medium text-sm flex gap-2 items-center justify-center">
        <span className="h-1 w-1 rounded-full bg-black"></span>
        <span>
          Scrap data from{" "}
          <a
            href="https://www.linkedin.com/sales/search/company"
            target="_blank"
            className="text-blue-400 underline font-medium"
          >
            Account
          </a>{" "}
          & make sure you filtered your account
        </span>
      </h1>

      <div className="flex items-center gap-1">
        <div>
          <IoWarning className="text-yellow-600 text-2xl" />
        </div>
        <div>
          <h5 className="text-sm text-[#1f476f] font- tracking-wider inline">
            Please Scroll the page to bottom{" "}
            <span className="font-bold">first </span>
          </h5>
          <IoArrowDownCircleSharp className="text-2xl inline animate-bounce mx-2" />
          <h5 className="text-sm text-[#1f476f] font- tracking-wider inline">
            & make sure you load all data on your screen
          </h5>
        </div>
      </div>

      <div className="text-center space-y-3">
        <div>
          <button
            onClick={fetchListData}
            className="py-2 px-4 bg-sky-600 rounded-lg cursor-pointer text-white"
          >
            Scrap This Table
          </button>
        </div>

        {tableSheetCount > 0 && (
          <div className="p-3 bg-green-50 rounded-lg space-y-2">
            <p className="text-sm font-semibold text-green-800">
              Total Rows Collected: {tableSheetCount}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={downloadCsv}
                className="py-2 px-4 bg-green-600 rounded-lg cursor-pointer text-white hover:bg-green-700 transition-colors"
              >
                Download CSV
              </button>
              <button
                onClick={clearData}
                className="py-2 px-4 bg-red-600 rounded-lg cursor-pointer text-white hover:bg-red-700 transition-colors"
              >
                Clear Data
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default AccountList;
