window.leafletMap = {
    map: null,
    markers: [],
    dotNetRef: null,

    initialize: function (elementId, centerLat, centerLng, zoom) {
        // Destroy existing map if any
        if (this.map) {
            this.map.remove();
            this.map = null;
            this.markers = [];
        }

        // Create new map
        this.map = L.map(elementId).setView([centerLat, centerLng], zoom);

        // Add tile layer (OpenStreetMap)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(this.map);

        return true;
    },

    setDotNetRef: function (dotNetRef) {
        this.dotNetRef = dotNetRef;
        return true;
    },

    setView: function (lat, lng, zoom) {
        if (!this.map) return false;
        this.map.setView([lat, lng], zoom);
        return true;
    },

    addMarker: function (lat, lng, popupContent, customerId) {
        if (!this.map) return false;

        var self = this;

        // Add a clickable link to the popup content
        var contentWithLink = popupContent +
            '<br/><a href="#" class="view-customer-link" data-customer-id="' + customerId + '" ' +
            'style="color: #16a34a; text-decoration: underline; font-weight: 500; cursor: pointer;">' +
            'View Customer →</a>';

        var marker = L.marker([lat, lng])
            .addTo(this.map)
            .bindPopup(contentWithLink);

        // Add click handler for the popup link
        marker.on('popupopen', function () {
            var link = document.querySelector('.view-customer-link[data-customer-id="' + customerId + '"]');
            if (link) {
                link.onclick = function (e) {
                    e.preventDefault();
                    if (self.dotNetRef) {
                        self.dotNetRef.invokeMethodAsync('OnMarkerClick', customerId);
                    }
                };
            }
        });

        marker.customerId = customerId;
        this.markers.push(marker);

        return true;
    },

    clearMarkers: function () {
        if (!this.map) return false;

        this.markers.forEach(function (marker) {
            marker.remove();
        });
        this.markers = [];

        return true;
    },

    fitBounds: function () {
        if (!this.map || this.markers.length === 0) return false;

        var group = L.featureGroup(this.markers);
        this.map.fitBounds(group.getBounds().pad(0.1));

        return true;
    },

    destroy: function () {
        if (this.map) {
            this.map.remove();
            this.map = null;
            this.markers = [];
        }
        return true;
    }
};
