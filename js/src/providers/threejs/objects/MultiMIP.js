// jshint maxstatements:false,maxcomplexity:false

const THREE = require('three');
const _ = require('../../../lodash');
const colorMapHelper = require('../../../core/lib/helpers/colorMap');
const {typedArrayToThree} = require('../helpers/Fn');
const {areAllChangesResolve} = require('../helpers/Fn');
const {commonUpdate} = require('../helpers/Fn');
const {ensure256size} = require('../helpers/Fn');

/**
 * Loader strategy to handle Volume object
 * @method MultiMIP
 * @memberof K3D.Providers.ThreeJS.Objects
 * @param {Object} config all configurations params from JSON
 * @param {K3D}
 * @return {Object} 3D object ready to render
 */
module.exports = {
    create(config) {
        config.samples = config.samples || 512.0;
        config.gradient_step = config.gradient_step || 0.005;
        config.interpolation = typeof (config.interpolation) !== 'undefined' ? config.interpolation : true;

        const number = config.volume_list.length;
        const randomMul = typeof (window.randomMul) !== 'undefined' ? window.randomMul : 255.0;
        const geometry = new THREE.BoxBufferGeometry(1, 1, 1);
        const modelMatrix = new THREE.Matrix4();
        const translation = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const colorMapList = config.color_map_list;
        let mask = null;
        let maskEnabled = false;
        const opacityFunctionList = config.opacity_function_list;
        const colorRangeList = config.color_range_list;
        const { samples } = config;
        const alphaBlending = config.alpha_blending;
        const texture = [];
        const colormap = [];
        let jitterTexture;

        modelMatrix.set.apply(modelMatrix, config.model_matrix.data);
        modelMatrix.decompose(translation, rotation, scale);

        for (let i = 0; i < number; i++) {
            const texture_ = new THREE.Data3DTexture(
                config.volume_list[i].data,
                config.volume_list[i].shape[2],
                config.volume_list[i].shape[1],
                config.volume_list[i].shape[0],
            );

            texture_.format = THREE.RedFormat;
            texture_.type = typedArrayToThree(config.volume_list[i].data.constructor);

            texture_.generateMipmaps = false;

            if (config.interpolation) {
                texture_.minFilter = THREE.LinearFilter;
                texture_.magFilter = THREE.LinearFilter;
            } else {
                texture_.minFilter = THREE.NearestFilter;
                texture_.magFilter = THREE.NearestFilter;
            }

            texture_.wrapS = THREE.ClampToEdgeWrapping;
            texture_.wrapT = THREE.ClampToEdgeWrapping;
            texture_.wrapR = THREE.ClampToEdgeWrapping;
            texture_.needsUpdate = true;

            texture.push(texture_);
        }

        jitterTexture = new THREE.DataTexture(
            new Uint8Array(_.range(64 * 64).map(() => randomMul * Math.random())),
            64,
            64,
            THREE.RedFormat,
            THREE.UnsignedByteType,
        );
        jitterTexture.minFilter = THREE.LinearFilter;
        jitterTexture.magFilter = THREE.LinearFilter;
        jitterTexture.wrapS = THREE.MirroredRepeatWrapping;
        jitterTexture.wrapT = THREE.MirroredRepeatWrapping;
        jitterTexture.generateMipmaps = false;
        jitterTexture.needsUpdate = true;

        for (let i = 0; i < number; i++) {
            const canvas = colorMapHelper.createCanvasGradient(colorMapList[i].data, 1024, opacityFunctionList[i].data);
            const colormap_ = new THREE.CanvasTexture(
                canvas,
                THREE.UVMapping,
                THREE.ClampToEdgeWrapping,
                THREE.ClampToEdgeWrapping,
                THREE.NearestFilter,
                THREE.NearestFilter,
            );
            colormap_.needsUpdate = true;
            colormap.push(colormap_);
        }

        if (config.mask.data.length > 0 && config.mask_opacities.data.length > 0) {
            mask = new THREE.Data3DTexture(
                config.mask.data,
                config.mask.shape[2],
                config.mask.shape[1],
                config.mask.shape[0],
            );
            mask.format = THREE.RedFormat;
            mask.type = THREE.UnsignedByteType;

            mask.generateMipmaps = false;
            mask.minFilter = THREE.NearestFilter;
            mask.magFilter = THREE.NearestFilter;
            mask.wrapS = THREE.ClampToEdgeWrapping;
            mask.wrapT = THREE.ClampToEdgeWrapping;
            mask.needsUpdate = true;

            maskEnabled = true;
        }

        const uniforms = {
            number: { value: number },
            maskOpacities: { value: ensure256size(config.mask_opacities.data) },
            gradient_step: { value: config.gradient_step },
            samples: { value: samples },
            alpha_blending: { value: alphaBlending },
            translation: { value: translation },
            rotation: { value: rotation },
            scale: { value: scale },
            mask: { type: 't', value: mask },
            jitterTexture: { type: 't', value: jitterTexture },
        };
        for (let i = 0; i < number; i++) {
            uniforms[`low${i}`] = { value: colorRangeList[i][0] };
            uniforms[`high${i}`] = { value: colorRangeList[i][1] };
            uniforms[`volumeTexture${i}`] = { type: 't', value: texture[i] };
            uniforms[`colormap${i}`] = { type: 't', value: colormap[i] };
        }
        for (let i = number; i < 4; i++) {
            uniforms[`low${i}`] = { value: 0.0 };
            uniforms[`high${i}`] = { value: 1.0 };
            uniforms[`volumeTexture${i}`] = { type: 't', value: new THREE.Data3DTexture(null, 0, 0, 0) };
            uniforms[`colormap${i}`] = { type: 't', value: new THREE.CanvasTexture(null) };
        }

        const material = new THREE.ShaderMaterial({
            uniforms: _.merge(
                uniforms,
                THREE.UniformsLib.lights,
            ),
            defines: {
                USE_SPECULAR: 0,
                USE_MASK: (maskEnabled ? 1 : 0),
            },
            vertexShader: require('./shaders/MultiMIP.vertex.glsl'),
            fragmentShader: require('./shaders/MultiMIP.fragment.glsl'),
            side: THREE.BackSide,
            depthTest: false,
            depthWrite: false,
            lights: false,
            clipping: true,
            transparent: true,
        });

        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();

        const object = new THREE.Mesh(geometry, material);
        object.applyMatrix4(modelMatrix);
        object.updateMatrixWorld();

        object.onRemove = function () {
            for (let i = 0; i < 4; i++) {
                object.material.uniforms[`volumeTexture${i}`].value.dispose();
                object.material.uniforms[`volumeTexture${i}`].value = undefined;
                object.material.uniforms[`colormap${i}`].value.dispose();
                object.material.uniforms[`colormap${i}`].value = undefined;
            }
            jitterTexture.dispose();
            jitterTexture = undefined;
            if (maskEnabled) {
                mask.dispose();
                mask = undefined;
            }
        };

        return Promise.resolve(object);
    },

    // @TODO: update method should handle volume_list, color_range_list, color_map_list, opacity_function_list
    update(config, changes, obj, K3D) {
        const resolvedChanges = {};

        if (typeof (changes.color_range) !== 'undefined' && !changes.color_range.timeSeries) {
            obj.material.uniforms.low.value = changes.color_range[0];
            obj.material.uniforms.high.value = changes.color_range[1];

            resolvedChanges.color_range = null;
        }

        if (typeof (changes.volume) !== 'undefined' && !changes.volume.timeSeries) {
            if (obj.material.uniforms.volumeTexture.value.image.data.constructor === changes.volume.data.constructor) {
                obj.material.uniforms.volumeTexture.value.image.data = changes.volume.data;
                obj.material.uniforms.volumeTexture.value.needsUpdate = true;

                resolvedChanges.volume = null;
            }
        }

        if ((typeof (changes.color_map) !== 'undefined' && !changes.color_map.timeSeries)
            || (typeof (changes.opacity_function) !== 'undefined' && !changes.opacity_function.timeSeries)) {
            const canvas = colorMapHelper.createCanvasGradient(
                (changes.color_map && changes.color_map.data) || config.color_map.data,
                1024,
                (changes.opacity_function && changes.opacity_function.data) || config.opacity_function.data,
            );

            obj.material.uniforms.colormap.value.image = canvas;
            obj.material.uniforms.colormap.value.needsUpdate = true;

            resolvedChanges.color_map = null;
            resolvedChanges.opacity_function = null;
        }

        if (typeof (changes.mask) !== 'undefined' && !changes.mask.timeSeries) {
            if (obj.material.uniforms.mask.value !== null) {
                if (obj.material.uniforms.mask.value.image.data.constructor === changes.mask.data.constructor
                    && obj.material.uniforms.mask.value.image.width === changes.mask.shape[2]
                    && obj.material.uniforms.mask.value.image.height === changes.mask.shape[1]
                    && obj.material.uniforms.mask.value.image.depth === changes.mask.shape[0]) {
                    obj.material.uniforms.mask.value.image.data = changes.mask.data;
                    obj.material.uniforms.mask.value.needsUpdate = true;

                    resolvedChanges.mask = null;
                }
            }
        }

        if (typeof (changes.mask_opacities) !== 'undefined' && !changes.mask_opacities.timeSeries) {
            if (obj.material.uniforms.maskOpacities.value !== null) {
                obj.material.uniforms.maskOpacities.value = ensure256size(changes.mask_opacities.data);
                obj.material.uniforms.maskOpacities.value.needsUpdate = true;

                resolvedChanges.mask_opacities = null;
            }
        }

        ['samples', 'gradient_step'].forEach((key) => {
            if (changes[key] && !changes[key].timeSeries) {
                obj.material.uniforms[key].value = changes[key];
                resolvedChanges[key] = null;
            }
        });

        commonUpdate(config, changes, resolvedChanges, obj, K3D);

        if (areAllChangesResolve(changes, resolvedChanges)) {
            return Promise.resolve({json: config, obj});
        }
        return false;
    },
};
