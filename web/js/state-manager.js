(function (root) {
  function localDateKeyNow() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  var state = {
    currentSharedAnalysisDto: null,
    selectedStation: null,
    selectedDate: localDateKeyNow(),
    analysisDtoByDay: {},
    userLocation: null,
    locationPromptDismissed: false,
    page: 'dashboard',
    stations: [],
    cache: {}
  };

  function getState() {
    return state;
  }

  function update(partial) {
    state = Object.assign({}, state, partial || {});
    return state;
  }

  function cacheKey(stationId, date) {
    return String(stationId || '') + '::' + String(date || '');
  }

  function getCached(stationId, date) {
    return state.cache[cacheKey(stationId, date)] || null;
  }

  function setCached(stationId, date, dto) {
    var key = cacheKey(stationId, date);
    state.cache[key] = dto;
  }

  root.NavidurState = {
    getState: getState,
    update: update,
    getCached: getCached,
    setCached: setCached
  };
})(window);
