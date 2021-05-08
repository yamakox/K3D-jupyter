'use strict';
//jshint maxstatements:false

var widgets = require('@jupyter-widgets/base'),
    _ = require('./lodash'),
    K3D = require('./core/Core'),
    TFEdit = require('./transferFunctionEditor'),
    serialize = require('./core/lib/helpers/serialize'),
    ThreeJsProvider = require('./providers/threejs/provider'),
    PlotModel,
    PlotView,
    ChunkModel,
    ObjectModel,
    ObjectView,
    semverRange = require('./version').version,
    objectsList = {},
    chunkList = {},
    plotsList = [];

require('es6-promise');

function runOnEveryPlot(id, cb) {
    plotsList.forEach(function (plot) {
        if (plot.model.get('object_ids').indexOf(id) !== -1) {
            cb(plot, plot.K3DInstance.getObjectById(id));
        }
    });
}

ChunkModel = widgets.WidgetModel.extend({
    defaults: _.extend(_.result({}, 'widgets.WidgetModel.prototype.defaults'), {
        _model_name: 'ChunkModel',
        _model_module: 'k3d',
        _model_module_version: semverRange
    }),

    initialize: function () {
        var chunk = arguments[0];

        widgets.WidgetModel.prototype.initialize.apply(this, arguments);

        this.on('change', this._change, this);

        chunkList[chunk.id] = this;
    },

    _change: function () {
        var chunk = this.attributes;

        Object.keys(objectsList).forEach(function (id) {
            if (objectsList[id].attributes.type === 'VoxelsGroup') {
                runOnEveryPlot(objectsList[id].attributes.id, function (plot, objInstance) {
                    objInstance.updateChunk(chunk);
                });
            }
        });
    }
}, {
    serializers: _.extend({
        voxels: serialize,
        coord: serialize
    }, widgets.WidgetModel.serializers)
});

ObjectModel = widgets.WidgetModel.extend({
    defaults: _.extend(_.result({}, 'widgets.WidgetModel.prototype.defaults'), {
        _model_name: 'ObjectModel',
        _view_name: 'ObjectView',
        _model_module: 'k3d',
        _view_module: 'k3d',
        _model_module_version: semverRange,
        _view_module_version: semverRange
    }),

    initialize: function () {
        var obj = arguments[0];

        widgets.WidgetModel.prototype.initialize.apply(this, arguments);

        this.on('change', this._change, this);
        this.on('msg:custom', function (msg) {
            var obj;

            if (msg.msg_type === 'fetch') {
                obj = this.get(msg.field);

                // hack because of https://github.com/jashkenas/underscore/issues/2692
                if (_.isObject(obj)) {
                    obj.t = Math.random();
                }

                if (obj.data && obj.shape) {
                    obj.compression_level = this.attributes.compression_level;
                }

                this.save(msg.field, obj);
            }

            if (msg.msg_type === 'shadow_map_update' && this.get('type') === 'Volume') {
                runOnEveryPlot(this.get('id'), function (plot, objInstance) {
                    objInstance.refreshLightMap(msg.direction);
                    plot.K3DInstance.render();
                });
            }
        }, this);

        objectsList[obj.id] = this;
    },

    _change: function (c) {
        plotsList.forEach(function (plot) {
            plot.refreshObject(this, c.changed);
        }, this);
    }
}, {
    serializers: _.extend({
        model_matrix: serialize,
        positions: serialize,
        scalar_field: serialize,
        alpha_coef: serialize,
        shadow: serialize,
        shadow_res: serialize,
        shadow_delay: serialize,
        ray_samples_count: serialize,
        focal_plane: serialize,
        focal_length: serialize,
        gradient_step: serialize,
        color_map: serialize,
        samples: serialize,
        color_range: serialize,
        attribute: serialize,
        triangles_attribute: serialize,
        vertices: serialize,
        indices: serialize,
        colors: serialize,
        origins: serialize,
        vectors: serialize,
        opacity: serialize,
        opacities: serialize,
        point_size: serialize,
        width: serialize,
        shader: serialize,
        wireframe: serialize,
        radial_segments: serialize,
        color: serialize,
        flat_shading: serialize,
        heights: serialize,
        mesh_detail: serialize,
        voxels: serialize,
        voxels_group: serialize,
        sparse_voxels: serialize,
        space_size: serialize,
        volume: serialize,
        opacity_function: serialize,
        text: serialize,
        size: serialize,
        position: serialize,
        puv: serialize,
        visible: serialize,
        uvs: serialize,
        volume_bounds: serialize,
        spacings_x: serialize,
        spacings_y: serialize,
        spacings_z: serialize,
        volume_list: serialize,
        color_map_list: serialize,
        opacity_function_list: serialize,
        color_range_list: serialize,
    }, widgets.WidgetModel.serializers)
});

ObjectView = widgets.WidgetView.extend({});

PlotModel = widgets.DOMWidgetModel.extend({
    defaults: _.extend(_.result({}, 'widgets.DOMWidgetModel.prototype.defaults'), {
        _model_name: 'PlotModel',
        _view_name: 'PlotView',
        _model_module: 'k3d',
        _view_module: 'k3d',
        _model_module_version: semverRange,
        _view_module_version: semverRange
    })
});

// Custom View. Renders the widget model.
PlotView = widgets.DOMWidgetView.extend({
    render: function () {
        var containerEnvelope = window.document.createElement('div'),
            container = window.document.createElement('div');

        containerEnvelope.style.cssText = [
            'height:' + this.model.get('height') + 'px',
            'position: relative'
        ].join(';');

        container.style.cssText = [
            'width: 100%',
            'height: 100%',
            'position: relative'
        ].join(';');

        containerEnvelope.appendChild(container);
        this.el.appendChild(containerEnvelope);

        this.container = container;
        this.on('displayed', this._init, this);
    },

    remove: function () {
        _.pull(plotsList, this);
        this.K3DInstance.off(this.K3DInstance.events.CAMERA_CHANGE, this.cameraChangeId);
        this.K3DInstance.off(this.K3DInstance.events.OBJECT_CHANGE, this.GUIObjectChanges);
        this.K3DInstance.off(this.K3DInstance.events.PARAMETERS_CHANGE, this.GUIParametersChanges);
        this.K3DInstance.off(this.K3DInstance.events.VOXELS_CALLBACK, this.voxelsCallback);
        this.K3DInstance.off(this.K3DInstance.events.OBJECT_HOVERED, this.objectHoverCallback);
        this.K3DInstance.off(this.K3DInstance.events.OBJECT_CLICKED, this.objectClickCallback);
    },

    _init: function () {
        var self = this;

        this.renderPromises = [];

        plotsList.push(this);

        this.model.lastCameraSync = (new Date()).getTime();

        this.model.on('msg:custom', function (obj) {
            var model = this.model;

            if (obj.msg_type === 'fetch_screenshot') {
                this.K3DInstance.getScreenshot(this.K3DInstance.parameters.screenshotScale, obj.only_canvas)
                    .then(function (canvas) {
                        var data = canvas.toDataURL().split(',')[1];

                        model.save('screenshot', data);
                    });
            }

            if (obj.msg_type === 'fetch_snapshot') {
                model.save('snapshot', this.K3DInstance.getHTMLSnapshot(obj.compression_level));
            }

            if (obj.msg_type === 'start_auto_play') {
                this.K3DInstance.startAutoPlay();
            }

            if (obj.msg_type === 'stop_auto_play') {
                this.K3DInstance.stopAutoPlay();
            }

            if (obj.msg_type === 'reset_camera') {
                this.K3DInstance.resetCamera(obj.factor);
            }

            if (obj.msg_type === 'render') {
                if (self.renderPromises.length === 0) {
                    self.K3DInstance.refreshAfterObjectsChange(false, true);
                } else {
                    Promise.all(self.renderPromises).then(function (values) {
                        self.K3DInstance.refreshAfterObjectsChange(false, true);

                        if (values.length === self.renderPromises.length) {
                            self.renderPromises = [];
                        }
                    });
                }
            }
        }, this);

        this.model.on('change:camera_auto_fit', this._setCameraAutoFit, this);
        this.model.on('change:lighting', this._setDirectionalLightingIntensity, this);
        this.model.on('change:time', this._setTime, this);
        this.model.on('change:grid_auto_fit', this._setGridAutoFit, this);
        this.model.on('change:grid_visible', this._setGridVisible, this);
        this.model.on('change:fps_meter', this._setFpsMeter, this);
        this.model.on('change:fps', this._setFps, this);
        this.model.on('change:screenshot_scale', this._setScreenshotScale, this);
        this.model.on('change:voxel_paint_color', this._setVoxelPaintColor, this);
        this.model.on('change:background_color', this._setBackgroundColor, this);
        this.model.on('change:grid', this._setGrid, this);
        this.model.on('change:auto_rendering', this._setAutoRendering, this);
        this.model.on('change:camera', this._setCamera, this);
        this.model.on('change:camera_animation', this._setCameraAnimation, this);
        this.model.on('change:clipping_planes', this._setClippingPlanes, this);
        this.model.on('change:object_ids', this._onObjectsListChange, this);
        this.model.on('change:menu_visibility', this._setMenuVisibility, this);
        this.model.on('change:colorbar_object_id', this._setColorMapLegend, this);
        this.model.on('change:colorbar_scientific', this._setColorbarScientific, this);
        this.model.on('change:rendering_steps', this._setRenderingSteps, this);
        this.model.on('change:axes', this._setAxes, this);
        this.model.on('change:camera_no_rotate', this._setCameraLock, this);
        this.model.on('change:camera_no_zoom', this._setCameraLock, this);
        this.model.on('change:camera_no_pan', this._setCameraLock, this);
        this.model.on('change:camera_rotate_speed', this._setCameraSpeeds, this);
        this.model.on('change:camera_zoom_speed', this._setCameraSpeeds, this);
        this.model.on('change:camera_pan_speed', this._setCameraSpeeds, this);
        this.model.on('change:camera_fov', this._setCameraFOV, this);
        this.model.on('change:axes_helper', this._setAxesHelper, this);
        this.model.on('change:snapshot_include_js', this._setSnapshotIncludeJs, this);
        this.model.on('change:name', this._setName, this);
        this.model.on('change:mode', this._setViewMode, this);
        this.model.on('change:camera_mode', this._setCameraMode, this);
        this.model.on('change:manipulate_mode', this._setManipulateMode, this);

        try {
            this.K3DInstance = new K3D(ThreeJsProvider, this.container, {
                antialias: this.model.get('antialias'),
                lighting: this.model.get('lighting'),
                cameraMode: this.model.get('camera_mode'),
                snapshotIncludeJs: this.model.get('snapshot_include_js'),
                backendVersion: this.model.get('_backend_version'),
                screenshotScale: this.model.get('screenshot_scale'),
                menuVisibility: this.model.get('menu_visibility'),
                cameraNoRotate: this.model.get('camera_no_rotate'),
                cameraNoZoom: this.model.get('camera_no_zoom'),
                cameraNoPan: this.model.get('camera_no_pan'),
                cameraRotateSpeed: this.model.get('camera_rotate_speed'),
                cameraZoomSpeed: this.model.get('camera_zoom_speed'),
                cameraPanSpeed: this.model.get('camera_pan_speed'),
                colorbarObjectId: this.model.get('colorbar_object_id'),
                cameraAnimation: this.model.get('camera_animation'),
                name: this.model.get('name'),
                axes: this.model.get('axes'),
                axesHelper: this.model.get('axes_helper'),
                grid: this.model.get('grid'),
                fps: this.model.get('fps'),
                autoRendering: this.model.get('auto_rendering'),
                gridVisible: this.model.get('grid_visible')
            });

            if (this.model.get('camera_auto_fit') === false) {
                this.K3DInstance.setCamera(this.model.get('camera'));
            }
        } catch (e) {
            console.log(e);
            return;
        }

        this.K3DInstance.setClearColor(this.model.get('background_color'));
        this.K3DInstance.setChunkList(chunkList);

        this._setCameraAutoFit();
        this._setGridAutoFit();
        this._setMenuVisibility();
        this._setVoxelPaintColor();

        this.model.get('object_ids').forEach(function (id) {
            this.renderPromises.push(this.K3DInstance.load({objects: [objectsList[id].attributes]}));
        }, this);

        this.cameraChangeId = this.K3DInstance.on(this.K3DInstance.events.CAMERA_CHANGE, function (control) {
            self.model.set('camera', control);

            if ((new Date()).getTime() - self.model.lastCameraSync > 200) {
                self.model.lastCameraSync = (new Date()).getTime();
                self.model.save_changes();
            }
        });

        this.GUIObjectChanges = this.K3DInstance.on(this.K3DInstance.events.OBJECT_CHANGE, function (change) {
            if (self.model._comm_live) {
                if (change.value.data && change.value.shape) {
                    change.value.compression_level = objectsList[change.id].attributes.compression_level;
                }

                // objectsList[change.id].set(change.key, change.value);
                // objectsList[change.id].save_changes();
                objectsList[change.id].save(change.key, change.value, {patch: true});
            }
        });

        this.GUIParametersChanges = this.K3DInstance.on(this.K3DInstance.events.PARAMETERS_CHANGE, function (change) {
            self.model.save(change.key, change.value, {patch: true});
        });

        this.voxelsCallback = this.K3DInstance.on(this.K3DInstance.events.VOXELS_CALLBACK, function (param) {
            if (objectsList[param.object.K3DIdentifier]) {
                objectsList[param.object.K3DIdentifier].send({msg_type: 'click_callback', coord: param.coord});
            }
        });

        this.objectHoverCallback = this.K3DInstance.on(this.K3DInstance.events.OBJECT_HOVERED, function (param) {
            if (objectsList[param.object.K3DIdentifier]) {
                objectsList[param.object.K3DIdentifier].send({
                    msg_type: 'hover_callback',
                    position: param.point.toArray(),
                    normal: param.face.normal.toArray(),
                    distance: param.distance,
                    face_index: param.faceIndex
                });
            }
        });

        this.objectClickCallback = this.K3DInstance.on(this.K3DInstance.events.OBJECT_CLICKED, function (param) {
            if (objectsList[param.object.K3DIdentifier]) {
                objectsList[param.object.K3DIdentifier].send({
                    msg_type: 'click_callback',
                    position: param.point.toArray(),
                    normal: param.face.normal.toArray(),
                    distance: param.distance,
                    face_index: param.faceIndex
                });
            }
        });
    },

    _setDirectionalLightingIntensity: function () {
        this.K3DInstance.setDirectionalLightingIntensity(this.model.get('lighting'));
    },

    _setTime: function () {
        this.renderPromises.push(this.K3DInstance.setTime(this.model.get('time')));
    },

    _setCameraAutoFit: function () {
        this.K3DInstance.setCameraAutoFit(this.model.get('camera_auto_fit'));
    },

    _setGridAutoFit: function () {
        this.K3DInstance.setGridAutoFit(this.model.get('grid_auto_fit'));
    },

    _setGridVisible: function () {
        this.K3DInstance.setGridVisible(this.model.get('grid_visible'));
    },

    _setFps: function () {
        this.K3DInstance.setFps(this.model.get('fps'));
    },

    _setFpsMeter: function () {
        this.K3DInstance.setFpsMeter(this.model.get('fps_meter'));
    },

    _setScreenshotScale: function () {
        this.K3DInstance.setScreenshotScale(this.model.get('screenshot_scale'));
    },

    _setVoxelPaintColor: function () {
        this.K3DInstance.setVoxelPaint(this.model.get('voxel_paint_color'));
    },

    _setBackgroundColor: function () {
        this.K3DInstance.setClearColor(this.model.get('background_color'));
    },

    _setGrid: function () {
        this.K3DInstance.setGrid(this.model.get('grid'));
    },

    _setAutoRendering: function () {
        this.K3DInstance.setAutoRendering(this.model.get('auto_rendering'));
    },

    _setMenuVisibility: function () {
        this.K3DInstance.setMenuVisibility(this.model.get('menu_visibility'));
    },

    _setColorMapLegend: function () {
        this.K3DInstance.setColorMapLegend(this.model.get('colorbar_object_id'));
    },

    _setColorbarScientific: function () {
        this.K3DInstance.setColorbarScientific(this.model.get('colorbar_scientific'));
    },

    _setCamera: function () {
        this.K3DInstance.setCamera(this.model.get('camera'));
    },

    _setCameraAnimation: function () {
        this.K3DInstance.setCameraAnimation(this.model.get('camera_animation'));
    },

    _setRenderingSteps: function () {
        this.K3DInstance.setRenderingSteps(this.model.get('rendering_steps'));
    },

    _setAxes: function () {
        this.K3DInstance.setAxes(this.model.get('axes'));
    },

    _setName: function () {
        this.K3DInstance.setName(this.model.get('name'));
    },

    _setViewMode: function () {
        this.K3DInstance.setViewMode(this.model.get('mode'));
    },

    _setCameraMode: function () {
        this.K3DInstance.setCameraMode(this.model.get('camera_mode'));
    },

    _setManipulateMode: function () {
        this.K3DInstance.setManipulateMode(this.model.get('manipulate_mode'));
    },

    _setAxesHelper: function () {
        this.K3DInstance.setAxesHelper(this.model.get('axes_helper'));
    },

    _setSnapshotIncludeJs: function () {
        this.K3DInstance.setSnapshotIncludeJs(this.model.get('snapshot_include_js'));
    },

    _setCameraLock: function () {
        this.K3DInstance.setCameraLock(
            this.model.get('camera_no_rotate'),
            this.model.get('camera_no_zoom'),
            this.model.get('camera_no_pan')
        );
    },

    _setCameraSpeeds: function () {
        this.K3DInstance.setCameraSpeeds(
            this.model.get('camera_rotate_speed'),
            this.model.get('camera_zoom_speed'),
            this.model.get('camera_pan_speed')
        );
    },

    _setCameraFOV: function () {
        this.K3DInstance.setCameraFOV(this.model.get('camera_fov'));
    },

    _setClippingPlanes: function () {
        this.K3DInstance.setClippingPlanes(this.model.get('clipping_planes'));
    },

    _onObjectsListChange: function () {
        var old_object_ids = this.model.previous('object_ids'),
            new_object_ids = this.model.get('object_ids');

        _.difference(old_object_ids, new_object_ids).forEach(function (id) {
            this.renderPromises.push(this.K3DInstance.removeObject(id));
        }, this);

        _.difference(new_object_ids, old_object_ids).forEach(function (id) {
            this.renderPromises.push(this.K3DInstance.load({objects: [objectsList[id].attributes]}));
        }, this);
    },

    refreshObject: function (obj, changed) {
        if (this.model.get('object_ids').indexOf(obj.get('id')) !== -1) {
            this.renderPromises.push(this.K3DInstance.reload(objectsList[obj.get('id')].attributes, changed));
        }
    },

    processPhosphorMessage: function (msg) {
        widgets.DOMWidgetView.prototype.processPhosphorMessage.call(this, msg);
        switch (msg.type) {
            case 'after-attach':
                this.el.addEventListener('contextmenu', this, true);
                break;
            case 'before-detach':
                this.el.removeEventListener('contextmenu', this, true);
                break;
            case 'resize':
                this.handleResize(msg);
                break;
        }
    },

    handleEvent: function (event) {
        switch (event.type) {
            case 'contextmenu':
                this.handleContextMenu(event);
                break;
            default:
                widgets.DOMWidgetView.prototype.handleEvent.call(this, event);
                break;
        }
    },

    handleContextMenu: function (event) {
        // Cancel context menu if on renderer:
        if (this.container.contains(event.target)) {
            event.preventDefault();
            event.stopPropagation();
        }
    },

    handleResize: function () {
        if (this.K3DInstance) {
            this.K3DInstance.resizeHelper();
        }
    }
});

module.exports = {
    ChunkModel: ChunkModel,
    PlotModel: PlotModel,
    PlotView: PlotView,
    ObjectModel: ObjectModel,
    ObjectView: ObjectView,
    ThreeJsProvider: ThreeJsProvider,
    TransferFunctionEditor: TFEdit.transferFunctionEditor,
    TransferFunctionModel: TFEdit.transferFunctionModel,
    TransferFunctionView: TFEdit.transferFunctionView,
    K3D: K3D
};
