Mixdown Pipelines
=================

## pipelines.static - stream your static files. Usage:

##### Add pipeline plugin to your mixdown.json

```javascript
"app": {
  "plugins": {
    "pipelines": {
      "module": "mixdown-pipelines"
    }
  }
}
```
##### Add your static route handler:

```javascript
module.exports = function(httpContext) {
  var app = httpContext.app;
  var pl = app.plugins.pipelines.static();

  pl.name += ': ' + httpContext.url.path;

  pl.execute({
    path: httpContext.url.pathname.replace(/\/img/, ''),
    res: httpContext.response,
    locations: ['./' + app.id + '/img']
  });
};
```