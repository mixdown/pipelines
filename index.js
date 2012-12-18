var _ = require('lodash'),
    guid = require('guid'),
    util = require('util'),
    broadway = require('broadway'),
    mixdownPlugins = require('mixdown-plugins'),
    Pipeline = require('node-pipeline');

var PipelineFactory = function() {};

/**
* Core Controller which implements basic functionality for the entire site.     
* @param options {Object} - Initialization params.  Not used but reserved.
* @param siteConfig {Object)- the config for this instance.
*
**/
PipelineFactory.prototype.attach = function (options) {
    var app = options.app,
        actions = app.plugins,
        templateCache = null,
        _app = new broadway.App(),
        that = this;

    _.defaults(options, {
        timeout: 60000 // 60s
    });

    _app.use(new mixdownPlugins.Error(), { app: app });

    var newPipeline = function(name, res) {
        var pl = Pipeline.create(app.config.id + '-' + name);

        // set timeout for all pipelines.
        pl.timeout = options.timeout;

        pl.on('error', function(err, results) {
            var res = results[0] ? results[0].res : null;

            if (err) {

                // log pipeline error counts to graphite if metrics enabled.
                if (app.plugins.metrics) {
                    app.plugins.metrics.increment('pipeline-error-' + pl.name);
                }

                logger.error(err);
                if (res) {
                    var step = pl.steps.length < pl.currentStep ? pl.steps[pl.currentStep] : pl.steps[pl.steps.length - 1],
                        formattedError = {
                            message: 'Pipeline Error - ' + pl.name + '. Step - ' + step.name + '(' + pl.currentStep + ')\n',
                            stack: err && err.stack ? err.stack : '',
                            requestId: pl.results.length > 1 ? pl.results[1].requestId : null,
                            inner: err || {}
                        };

                    if (err instanceof Error) {
                        formattedError.message += (err.stack || '');
                    }
                    else if (typeof(err) == 'string') {
                        formattedError.message += err;
                    }
                    else if (err) {
                        formattedError.message += JSON.stringify(err);
                    }

                    // if declared in the parent app, use the error plugin from the app. 
                    if (app.plugins.error) {
                        app.plugins.error.fail(formattedError, res);
                    }
                    // otherwise, use the local one.
                    else {
                        _app.error.fail(formattedError, res);
                    }
                }
            }
        });

        pl.use(function(results, next) {
            var meta = { 
                requestId: guid.create().toString(), 
                start: (new Date()), 
                url: results[0].req ? results[0].req.url : null
            };

            logger.info('Pipeline Start: ' + util.inspect(meta));
            next(null, meta);
        }, 'Register Error Handling');

        // logging
        pl.on('step', function(name, action) {
            var requestId = pl.results && pl.results.length > 1 ? pl.results[1].requestId : null;
            logger.info([pl.name, name, requestId].join(': '));
        });

        return pl;
    };

    this.pipelines = {

        /** 
        * Generates a static file controller that uses siteConfig to find the content
        **/
        static: function() {
            var pl = newPipeline('Static File');

            pl.use(function(results, next) {
                var path = results[0].path,
                    res = results[0].res,
                    locations = results[0].locations;

                // add dynamic pipeline steps for each location.
                _.each(locations, function(loc) {

                    pl.use(function(results, next) {

                        // try the first location.  if not found (i.e. err exists, then move to next).  If found, then stop pipeline execution.
                        app.plugins.static.file({ path: loc + path, res: res }, function(err) {
                            if (err) {
                                next();
                            }
                            else {
                                 // stop will prevent more steps since res is already written.
                                 // next will allow the pipeline to clean up.
                                pl.stop().next();
                            }
                        })
                    });

                });

                pl.use(function(results, next) {
                    // if the pipeline makes it here, then it was not stopped and therefore has an error.
                    next('Could not find file "' + path + ' in these locations' + JSON.stringify(locations));
                }, "Error check step");

                next();

            }, "Resolve File path");


            // return the new pipeline
            return pl;
        },

        /**
        * Use this to create a generic controller that can be used for dynamic actions.  
        * This will setup error catching, default behaviors, and set the requestId for logging purposes.
        * @param name {String} Name of the pipeline.
        **/
        generic: function(name) {
            return newPipeline(name);
        }
    };

};

module.exports = PipelineFactory;