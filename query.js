let request = indexedDB.open("linear_databases");

request.onsuccess = function(event) {
  let db = event.target.result;
  // read databases object
  let databases = db.transaction("databases", "readonly").objectStore("databases").get("linear_c5960b76ece27a5d469c3bb090eeddaa");
  databases.onsuccess = function(event) {
    console.log(event.target.result);
  };
};

request.onerror = function(event) {
  // Error occurred while opening the database
  console.error("error", event);
};
