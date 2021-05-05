//jshint maxstatements:false,maxcomplexity:false

'use strict';

var THREE = require('three'),
    _ = require('./../../../lodash'),
    colorMapHelper = require('./../../../core/lib/helpers/colorMap'),
    typedArrayToThree = require('./../helpers/Fn').typedArrayToThree,
    areAllChangesResolve = require('./../helpers/Fn').areAllChangesResolve,
    commonUpdate = require('./../helpers/Fn').commonUpdate;

/**
 * Loader strategy to handle Volume object
 * @method Volume
 * @memberof K3D.Providers.ThreeJS.Objects
 * @param {Object} config all configurations params from JSON
 * @param {K3D}
 * @return {Object} 3D object ready to render
 */
module.exports = {
    create: function (config) {
        config.samples = config.samples || 512.0;
        config.gradient_step = config.gradient_step || 0.005;

        var number = config.volume.length;
        var geometry = new THREE.BoxBufferGeometry(1, 1, 1),
            modelMatrix = new THREE.Matrix4(),
            translation = new THREE.Vector3(),
            rotation = new THREE.Quaternion(),
            scale = new THREE.Vector3(),
            colorMap = config.color_map,
            opacityFunction = config.opacity_function,
            colorRange = config.color_range,
            samples = config.samples,
            object,
            texture = [],
            colormap = [],
            jitterTexture;

        modelMatrix.set.apply(modelMatrix, config.model_matrix.data);
        modelMatrix.decompose(translation, rotation, scale);

        for( var i = 0; i < number; i++ ) {
            var texture_ = new THREE.DataTexture3D(
                config.volume[i].data,
                config.volume[i].shape[2],
                config.volume[i].shape[1],
                config.volume[i].shape[0]);
            
            texture_.format = THREE.RedFormat;
            texture_.type = typedArrayToThree(config.volume[i].data.constructor);
            
            texture_.generateMipmaps = false;
            texture_.minFilter = THREE.LinearFilter;
            texture_.magFilter = THREE.LinearFilter;
            texture_.wrapS = texture_.wrapT = THREE.ClampToEdgeWrapping;
            texture_.needsUpdate = true;
            
            texture.push(texture_);
        }

        jitterTexture = new THREE.DataTexture(
            new Uint8Array(_.range(64 * 64).map(function () {
                return 255.0 * Math.random();
            })),
            64, 64, THREE.RedFormat, THREE.UnsignedByteType);
        jitterTexture.minFilter = THREE.LinearFilter;
        jitterTexture.magFilter = THREE.LinearFilter;
        jitterTexture.wrapS = jitterTexture.wrapT = THREE.MirroredRepeatWrapping;
        jitterTexture.generateMipmaps = false;
        jitterTexture.needsUpdate = true;

        for( var i = 0; i < number; i++ ) {
            var canvas = colorMapHelper.createCanvasGradient(colorMap[i].data, 1024, opacityFunction[i].data);
            var colormap_ = new THREE.CanvasTexture(canvas, THREE.UVMapping, THREE.ClampToEdgeWrapping,
                THREE.ClampToEdgeWrapping, THREE.NearestFilter, THREE.NearestFilter);
            colormap_.needsUpdate = true;
            colormap.push(colormap_);
        }
        
        var uniforms = {
            //volumeMapSize: {value: new THREE.Vector3(config.volume[0].shape[2], config.volume[0].shape[1], config.volume[0].shape[0])},
            number: {value: number},
            low0: {value: colorRange[0][0]},
            high0: {value: colorRange[0][1]},
            gradient_step: {value: config.gradient_step},
            samples: {value: samples},
            translation: {value: translation},
            rotation: {value: rotation},
            scale: {value: scale},
            volumeTexture0: {type: 't', value: texture[0]},
            colormap0: {type: 't', value: colormap[0]},
            jitterTexture: {type: 't', value: jitterTexture}
        };

        var material = new THREE.ShaderMaterial({
            uniforms: _.merge(
                uniforms,
                THREE.UniformsLib.lights
            ),
            defines: {
                USE_SPECULAR: 1
            },
            vertexShader: require('./shaders/MultiMIP.vertex.glsl'),
            fragmentShader: require('./shaders/MultiMIP.fragment.glsl'),
            side: THREE.BackSide,
            depthTest: false,
            depthWrite: false,
            lights: true,
            clipping: true,
            transparent: true
        });

        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();

        object = new THREE.Mesh(geometry, material);
        object.applyMatrix4(modelMatrix);
        object.updateMatrixWorld();

        object.onRemove = function () {
            object.material.uniforms.volumeTexture.value = undefined;
            object.material.uniforms.colormap.value.dispose();
            object.material.uniforms.colormap.value = undefined;
            jitterTexture.dispose();
            jitterTexture = undefined;
        };

        return Promise.resolve(object);
    },

    update: function (config, changes, obj) {
        var resolvedChanges = {};

        if (typeof(changes.color_range) !== 'undefined' && !changes.color_range.timeSeries) {
            obj.material.uniforms.low.value = changes.color_range[0];
            obj.material.uniforms.high.value = changes.color_range[1];

            resolvedChanges.color_range = null;
        }


        if (typeof(changes.volume) !== 'undefined' && !changes.volume.timeSeries) {
            if (obj.material.uniforms.volumeTexture.value.image.data.constructor === changes.volume.data.constructor) {
                obj.material.uniforms.volumeTexture.value.image.data = changes.volume.data;
                obj.material.uniforms.volumeTexture.value.needsUpdate = true;

                resolvedChanges.volume = null;
            }
        }

        if ((typeof(changes.color_map) !== 'undefined' && !changes.color_map.timeSeries) ||
            (typeof(changes.opacity_function) !== 'undefined' && !changes.opacity_function.timeSeries)) {

            var canvas = colorMapHelper.createCanvasGradient(
                (changes.color_map && changes.color_map.data) || config.color_map.data,
                1024,
                (changes.opacity_function && changes.opacity_function.data) || config.opacity_function.data
            );

            obj.material.uniforms.colormap.value.image = canvas;
            obj.material.uniforms.colormap.value.needsUpdate = true;

            resolvedChanges.color_map = null;
            resolvedChanges.opacity_function = null;
        }

        ['samples', 'gradient_step'].forEach(function (key) {
            if (changes[key] && !changes[key].timeSeries) {
                obj.material.uniforms[key].value = changes[key];
                resolvedChanges[key] = null;
            }
        });

        commonUpdate(config, changes, resolvedChanges, obj);

        if (areAllChangesResolve(changes, resolvedChanges)) {
            return Promise.resolve({json: config, obj: obj});
        } else {
            return false;
        }
    }
};
