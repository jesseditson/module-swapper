var App = new Marionette.Application({
  templates: (App || {}).templates
})

App.someProp = 'something'

App.getCurrentRoute = function() {
  return Backbone.history.fragment;
}
