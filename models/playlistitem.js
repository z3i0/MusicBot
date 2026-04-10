module.exports = (sequelize, DataTypes) => {
    const PlaylistItem = sequelize.define(
        "PlaylistItem",
        {
            playlistId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            title: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            url: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            thumbnail: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            duration: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            artist: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            platform: {
                type: DataTypes.STRING,
                allowNull: true,
            },
        },
        {
            tableName: "playlist_items",
            timestamps: true,
        }
    );

    PlaylistItem.associate = (models) => {
        PlaylistItem.belongsTo(models.Playlist, {
            as: "playlist",
            foreignKey: "playlistId",
        });
    };

    return PlaylistItem;
};
