/**
 * MR Updater — Google Apps Script for Merge Requests sheet
 * Uses header-driven column lookup — adapts to column changes automatically.
 * Replace your existing script with this.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('MR Updater')
    .addItem('Update Approvals Now', 'updateMrApprovals')
    .addItem('Set GitLab Token', 'setGitLabToken')
    .addItem('Create Daily Trigger (08:00)', 'createDailyTrigger')
    .addToUi();
}

function getColMap(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    map[headers[i]] = i + 1;
  }
  return map;
}

function updateMrApprovals() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Merge Requests');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Merge Requests sheet not found');
    return;
  }

  var cols = getColMap(sheet);
  var COL_IID = cols['MR IID'];
  var COL_TITLE = cols['Title'];
  var COL_AUTHOR = cols['Author'];
  var COL_ASSIGNEE = cols['Assignee'];
  var COL_SOURCE = cols['Source Branch'];
  var COL_TARGET = cols['Target Branch'];
  var COL_UPVOTES = cols['Approved (👍👍👍)'];
  var COL_REV_ID = cols['Rev ID'];
  var COL_APPROVED = cols['How Much Approved'];
  var COL_MRG = cols['Merged'];
  var COL_URL = cols['URL'];
  var COL_CREATED = cols['Created'];
  var COL_NOTES = cols['Notes'];
  var COL_TESTING = cols['Testing Status'];
  var COL_FINAL = cols['Final Status'];
  var COL_WHO = cols['Who Approved'];

  if (!COL_IID) {
    SpreadsheetApp.getUi().alert('Required column "MR IID" not found in header row');
    return;
  }

  var gitlabToken = PropertiesService.getScriptProperties().getProperty('GITLAB_TOKEN');
  if (!gitlabToken) {
    SpreadsheetApp.getUi().alert('GitLab token not set. Use MR Updater > Set GitLab Token first.');
    return;
  }

  var TOTAL_COLS = sheet.getLastColumn();
  var projectPath = 'your-project-path';
  var baseUrl = 'https://your-gitlab-instance.com/api/v4/projects/' + projectPath;

  var lastRow = sheet.getLastRow();
  var existingData = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues() : [];
  var existingIidMap = {};

  for (var i = 0; i < existingData.length; i++) {
    var row = existingData[i];
    var iidCell = row[COL_IID - 1] || '';
    var iid = parseInt(String(iidCell).replace(/^!/, ''), 10);
    if (!isNaN(iid)) {
      existingIidMap[iid] = { rowIndex: i + 2, rowData: row };
    }
  }

  Logger.log('Sheet has ' + Object.keys(existingIidMap).length + ' existing MRs');

  var openMrs = {};
  var page = 1;
  var fetchedAll = false;

  while (!fetchedAll) {
    var url = baseUrl + '/merge_requests?state=opened&per_page=100&page=' + page;
    var response = UrlFetchApp.fetch(url, {
      headers: { 'PRIVATE-TOKEN': gitlabToken },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('API error fetching page ' + page + ': ' + response.getResponseCode());
      break;
    }

    var batch = JSON.parse(response.getContentText());
    if (!batch || batch.length === 0) break;

    for (var j = 0; j < batch.length; j++) {
      var mr = batch[j];
      openMrs[mr.iid] = mr;
    }

    Logger.log('Page ' + page + ': fetched ' + batch.length + ' MRs');
    if (batch.length < 100) {
      fetchedAll = true;
    } else {
      page++;
    }
  }

  Logger.log('Total open MRs from GitLab: ' + Object.keys(openMrs).length);

  var updatedRows = {};
  var newMrs = [];
  var processedCount = 0;
  var errorCount = 0;

  var iidList = Object.keys(existingIidMap);
  for (var k = 0; k < iidList.length; k++) {
    var existingIid = parseInt(iidList[k], 10);
    var existing = existingIidMap[existingIid];

    if (openMrs[existingIid]) {
      var mr = openMrs[existingIid];
      var upvotes = mr.upvotes || 0;
      var rowNum = existing.rowIndex;

      var display = upvotes > 0 ? '\uD83D\uDC4D\u00D7' + upvotes : '';
      var cell = sheet.getRange(rowNum, COL_UPVOTES);
      cell.setValue(display);

      if (upvotes >= 3) {
        cell.setBackgroundRGB(172, 223, 182);
        cell.setFontWeight('bold');
      } else {
        cell.setBackground(null);
        cell.setFontWeight('normal');
      }

      if (COL_MRG) sheet.getRange(rowNum, COL_MRG).setValue('');

      processedCount++;
      updatedRows[existingIid] = true;
      Logger.log('!' + existingIid + ' | upvotes=' + upvotes + ' -> ' + display);
    } else {
      try {
        var mrUrl = baseUrl + '/merge_requests/' + existingIid;
        var mrResponse = UrlFetchApp.fetch(mrUrl, {
          headers: { 'PRIVATE-TOKEN': gitlabToken },
          muteHttpExceptions: true
        });

        if (mrResponse.getResponseCode() === 200) {
          var mrDetail = JSON.parse(mrResponse.getContentText());
          var rowNum = existing.rowIndex;

          if (COL_MRG) {
            if (mrDetail.state === 'merged') {
              var mergedDate = mrDetail.merged_at ? mrDetail.merged_at.substring(0, 10) : '';
              sheet.getRange(rowNum, COL_MRG).setValue('Merged ' + mergedDate);
            } else if (mrDetail.state === 'closed') {
              sheet.getRange(rowNum, COL_MRG).setValue('Closed');
            }
          }

          var upvotes = mrDetail.upvotes || 0;
          var display = upvotes > 0 ? '\uD83D\uDC4D\u00D7' + upvotes : '';
          var cell = sheet.getRange(rowNum, COL_UPVOTES);
          cell.setValue(display);
          if (upvotes >= 3) {
            cell.setBackgroundRGB(172, 223, 182);
            cell.setFontWeight('bold');
          }
        } else {
          Logger.log('!' + existingIid + ': check failed, leaving as-is');
        }
        processedCount++;
      } catch (e) {
        Logger.log('!' + existingIid + ': Error checking - ' + e.toString());
        errorCount++;
      }
    }
  }

  var openIids = Object.keys(openMrs);
  for (var m = 0; m < openIids.length; m++) {
    var iid = parseInt(openIids[m], 10);
    if (!updatedRows[iid]) {
      newMrs.push(openMrs[iid]);
    }
  }

  Logger.log('New MRs to add: ' + newMrs.length);

  if (newMrs.length > 0) {
    newMrs.sort(function(a, b) { return a.iid - b.iid; });

    var newRows = [];
    for (var n = 0; n < newMrs.length; n++) {
      var mr = newMrs[n];
      var authorName = mr.author ? mr.author.name || mr.author.username || '' : '';
      var assigneeName = mr.assignee ? mr.assignee.name || mr.assignee.username || '' : '';

      var row = [];
      for (var c = 1; c <= TOTAL_COLS; c++) {
        row.push('');
      }

      if (COL_IID) row[COL_IID - 1] = '!' + mr.iid;
      if (COL_TITLE) row[COL_TITLE - 1] = mr.title || '';
      if (COL_AUTHOR) row[COL_AUTHOR - 1] = authorName;
      if (COL_ASSIGNEE) row[COL_ASSIGNEE - 1] = assigneeName || '';
      if (COL_SOURCE) row[COL_SOURCE - 1] = mr.source_branch || '';
      if (COL_TARGET) row[COL_TARGET - 1] = mr.target_branch || '';
      if (COL_UPVOTES) row[COL_UPVOTES - 1] = mr.upvotes > 0 ? '\uD83D\uDC4D\u00D7' + mr.upvotes : '';
      if (COL_URL) row[COL_URL - 1] = mr.web_url || '';
      if (COL_CREATED) row[COL_CREATED - 1] = mr.created_at ? mr.created_at.substring(0, 10) : '';
      if (COL_TESTING) row[COL_TESTING - 1] = 'not tested';
      if (COL_FINAL) row[COL_FINAL - 1] = '';

      newRows.push(row);
    }

    var newStartRow = lastRow + 1;
    var newRange = sheet.getRange(newStartRow, 1, newRows.length, TOTAL_COLS);
    newRange.setValues(newRows);

    if (COL_IID) {
      var totalRows = lastRow - 1 + newRows.length;
      var numData = [];
      for (var p = 0; p < totalRows; p++) {
        numData.push([p + 1]);
      }
      sheet.getRange(2, 1, totalRows, 1).setValues(numData);
    }

    Logger.log('Appended ' + newRows.length + ' new MRs');
  }

  Logger.log('Done. Processed=' + processedCount + ', new=' + newMrs.length + ', errors=' + errorCount);
}

function setGitLabToken() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt('GitLab Token', 'Enter your GitLab personal access token:', ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty('GITLAB_TOKEN', result.getResponseText());
    ui.alert('GitLab token stored successfully.');
  }
}

function createDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'updateMrApprovals') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('updateMrApprovals')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  Logger.log('Daily trigger created for 08:00');
}
